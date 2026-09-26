import { build } from "esbuild";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const paymentEntryPoint = fileURLToPath(new URL("../docs/assets/microvern-payment.ts", import.meta.url));
const paymentOutput = fileURLToPath(new URL("../docs/assets/microvern-payment.js", import.meta.url));

await build({
  entryPoints: [paymentEntryPoint],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  outfile: paymentOutput,
  minify: true,
  legalComments: "none",
});

// Pera's embedded template strings retain harmless trailing whitespace. Remove
// it from the generated static asset so repository whitespace checks stay clean.
const generatedBundle = await readFile(paymentOutput, "utf8");
await writeFile(paymentOutput, generatedBundle.replace(/[\t ]+(?=\r?\n)/gu, ""));
