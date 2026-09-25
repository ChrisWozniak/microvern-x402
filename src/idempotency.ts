import { Pool } from "pg";

export interface CompletedIdempotencyResponse {
  readonly status: 200;
  readonly body: unknown;
  readonly paymentResponse: string | null;
}

export type IdempotencyAcquisition =
  | { readonly state: "acquired" }
  | { readonly state: "completed"; readonly response: CompletedIdempotencyResponse }
  | { readonly state: "in-progress" }
  | { readonly state: "conflict" };

export interface IdempotencyStore {
  readonly durable: boolean;
  initialize(): Promise<void>;
  acquire(key: string, requestHash: string, ttlMs: number): Promise<IdempotencyAcquisition>;
  complete(key: string, response: CompletedIdempotencyResponse, ttlMs: number): Promise<void>;
  release(key: string): Promise<void>;
}

interface InMemoryEntry {
  readonly state: "processing" | "completed";
  readonly requestHash: string;
  readonly expiresAt: number;
  readonly response?: CompletedIdempotencyResponse;
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  readonly durable = false;
  private readonly entries = new Map<string, InMemoryEntry>();

  async initialize(): Promise<void> {}

  async acquire(key: string, requestHash: string, ttlMs: number): Promise<IdempotencyAcquisition> {
    const now = Date.now();
    const entry = this.entries.get(key);
    if (entry !== undefined && entry.expiresAt <= now) this.entries.delete(key);

    const activeEntry = this.entries.get(key);
    if (activeEntry !== undefined && activeEntry.requestHash !== requestHash) return { state: "conflict" };
    if (activeEntry?.state === "completed" && activeEntry.response !== undefined) {
      return { state: "completed", response: activeEntry.response };
    }
    if (activeEntry?.state === "processing") return { state: "in-progress" };

    this.entries.set(key, { state: "processing", requestHash, expiresAt: now + ttlMs });
    return { state: "acquired" };
  }

  async complete(key: string, response: CompletedIdempotencyResponse, ttlMs: number): Promise<void> {
    const entry = this.entries.get(key);
    if (entry?.state !== "processing") return;
    this.entries.set(key, { state: "completed", requestHash: entry.requestHash, response, expiresAt: Date.now() + ttlMs });
  }

  async release(key: string): Promise<void> {
    const entry = this.entries.get(key);
    if (entry?.state === "processing") this.entries.delete(key);
  }
}

interface IdempotencyRow {
  state: "processing" | "completed";
  request_hash: string | null;
  response_status: number | null;
  response_body: unknown;
  payment_response: string | null;
}

/**
 * A shared Postgres-backed store. It records only completed API responses and
 * payment receipts; request bodies (which can contain unsigned transactions)
 * are never stored.
 */
export class PostgresIdempotencyStore implements IdempotencyStore {
  readonly durable = true;
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      application_name: "microvern-x402",
      connectionTimeoutMillis: 5_000,
      max: 10,
    });
  }

  async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS microvern_idempotency (
        idempotency_key VARCHAR(128) PRIMARY KEY,
        state VARCHAR(16) NOT NULL CHECK (state IN ('processing', 'completed')),
        request_hash VARCHAR(64),
        response_status SMALLINT,
        response_body JSONB,
        payment_response TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await this.pool.query("ALTER TABLE microvern_idempotency ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64)");
    await this.pool.query("CREATE INDEX IF NOT EXISTS microvern_idempotency_expires_at_idx ON microvern_idempotency (expires_at)");
  }

  async acquire(key: string, requestHash: string, ttlMs: number): Promise<IdempotencyAcquisition> {
    const expiresAt = new Date(Date.now() + ttlMs);
    const claim = await this.pool.query<{ state: "processing" }>(`
      INSERT INTO microvern_idempotency (idempotency_key, state, request_hash, expires_at)
      VALUES ($1, 'processing', $2, $3)
      ON CONFLICT (idempotency_key) DO UPDATE
      SET state = 'processing', response_status = NULL, response_body = NULL,
          payment_response = NULL, request_hash = EXCLUDED.request_hash,
          expires_at = EXCLUDED.expires_at
      WHERE microvern_idempotency.expires_at <= NOW()
      RETURNING state
    `, [key, requestHash, expiresAt]);
    if (claim.rowCount === 1) return { state: "acquired" };

    const existing = await this.pool.query<IdempotencyRow>(`
      SELECT state, request_hash, response_status, response_body, payment_response
      FROM microvern_idempotency
      WHERE idempotency_key = $1 AND expires_at > NOW()
    `, [key]);
    const row = existing.rows[0];
    if (row !== undefined && row.request_hash !== requestHash) return { state: "conflict" };
    if (
      row?.state === "completed"
      && row.response_status === 200
      && row.response_body !== null
    ) {
      return {
        state: "completed",
        response: {
          status: row.response_status,
          body: row.response_body,
          paymentResponse: row.payment_response,
        },
      };
    }
    return { state: "in-progress" };
  }

  async complete(key: string, response: CompletedIdempotencyResponse, ttlMs: number): Promise<void> {
    await this.pool.query(`
      UPDATE microvern_idempotency
      SET state = 'completed', response_status = $2, response_body = $3::jsonb,
          payment_response = $4, expires_at = $5
      WHERE idempotency_key = $1 AND state = 'processing'
    `, [key, response.status, JSON.stringify(response.body), response.paymentResponse, new Date(Date.now() + ttlMs)]);
  }

  async release(key: string): Promise<void> {
    await this.pool.query("DELETE FROM microvern_idempotency WHERE idempotency_key = $1 AND state = 'processing'", [key]);
  }
}

export function createIdempotencyStore(postgresUrl: string | undefined): IdempotencyStore {
  return postgresUrl === undefined ? new InMemoryIdempotencyStore() : new PostgresIdempotencyStore(postgresUrl);
}
