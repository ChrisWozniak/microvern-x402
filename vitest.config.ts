import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts", "docs/assets/*.{js,ts}"],
      exclude: [
        "test/**",
        "docs/assets/microvern-payment.js",
        "src/mcp-server.ts",
        "src/server.ts",
        "src/testnet-payer-client.ts",
      ],
      thresholds: {
        statements: 75,
        branches: 75,
        functions: 80,
        lines: 79,
      },
    },
  },
});
