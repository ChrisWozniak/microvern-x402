import { expect, test } from "@playwright/test";
import axe from "axe-core";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const docsRoot = resolve(fileURLToPath(new URL("../../docs", import.meta.url)));
const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
]);

let server: Server;
let baseUrl: string;

test.beforeAll(async () => {
  server = createServer(async (request, response) => {
    const requestedPath = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const relativePath = requestedPath === "/" ? "index.html" : requestedPath.replace(/^\/+/, "");
    const target = resolve(docsRoot, relativePath);
    if (target !== docsRoot && !target.startsWith(`${docsRoot}${sep}`)) {
      response.writeHead(403).end();
      return;
    }
    try {
      const contents = await readFile(target);
      response.writeHead(200, { "content-type": contentTypes.get(extname(target)) ?? "application/octet-stream" }).end(contents);
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("Static test server did not expose a TCP address.");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => error === undefined ? resolve() : reject(error)));
});

test("public review page is responsive, keyboard-navigable, and free of serious accessibility violations", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(baseUrl);

  await expect(page).toHaveTitle(/MicroVern/u);
  await expect(page.locator("h1")).toContainText("Know what you sign");
  await expect(page.locator("label[for='network']")).toBeVisible();
  await expect(page.locator("label[for='unsignedGroup']")).toBeVisible();
  await expect(page.locator("#validate")).toBeVisible();
  await expect(page.locator("#quoteButton")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.keyboard.press("Tab");
  const focused = page.locator(":focus");
  await expect(focused).toHaveText("Skip to main content");
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();

  await page.addScriptTag({ content: axe.source });
  const seriousViolations = await page.evaluate(async () => {
    const result = await (window as unknown as Window & { axe: typeof axe }).axe.run(document);
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => ({ id: violation.id, impact: violation.impact, targets: violation.nodes.map((node) => node.target) }));
  });
  expect(seriousViolations).toEqual([]);
});
