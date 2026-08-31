#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const loader = require.resolve("tsx");
const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const child = spawn(
  process.execPath,
  ["--import", loader, cli, ...process.argv.slice(2)],
  { stdio: "inherit" },
);
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
