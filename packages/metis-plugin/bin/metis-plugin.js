#!/usr/bin/env node

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliModulePath = resolve(__dirname, "../src/cli.ts");
const { runCli } = await import(cliModulePath);

runCli().then((code) => {
  process.exit(code);
}).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
