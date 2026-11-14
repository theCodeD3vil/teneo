// Bundle a backend file and run it on the real txiki runtime. For what needs
// `tjs:sqlite`, which bun doesn't have (`bun run test:runtime`), and for the dev
// peer (`bun run sync:peer`). Needs the tinyjs runtime in ~/.tinyjs.
//   bun scripts/run-on-tjs.ts <entry.ts> [args...]
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bundleForTjs, tjsBinary } from "./tjs-tools.ts";

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("usage: bun scripts/run-on-tjs.ts <entry.ts> [args...]");
  process.exit(2);
}

const folder = mkdtempSync(join(tmpdir(), "teneo-tjs-"));
const cleanUp = () => rmSync(folder, { recursive: true, force: true });

try {
  const bundle = join(folder, "bundle.js");
  bundleForTjs(entry, bundle);
  const child = spawn(tjsBinary, ["run", bundle, ...args], {
    stdio: "inherit",
  });
  // Ctrl-C reaches the program through the terminal; this wrapper just waits
  // for it to shut down, and passes on a plain `kill`
  process.on("SIGINT", () => {});
  process.on("SIGTERM", () => child.kill("SIGTERM"));
  child.on("exit", (code) => {
    cleanUp();
    process.exit(code ?? 1);
  });
} catch (error) {
  cleanUp();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
