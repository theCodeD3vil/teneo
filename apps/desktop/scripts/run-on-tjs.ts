// `bun run test:runtime`: bundle a backend file the way tinyjs bundles the
// backend, and run it on the real txiki runtime. For what needs `tjs:sqlite`,
// which bun doesn't have. Needs the tinyjs runtime in ~/.tinyjs.
//   bun scripts/run-on-tjs.ts <entry.ts> [args...]
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

const [entry, ...args] = process.argv.slice(2);
if (!entry) {
  console.error("usage: bun scripts/run-on-tjs.ts <entry.ts> [args...]");
  process.exit(2);
}

const tjs = join(homedir(), ".tinyjs/bin/tjs");
const esbuild = [
  "node_modules/.bin/esbuild",
  "../../node_modules/.bin/esbuild",
].find(existsSync);
if (!existsSync(tjs) || !esbuild) {
  console.error(
    existsSync(tjs)
      ? "esbuild is not installed: run `bun install`"
      : `the tinyjs runtime is not at ${tjs}`,
  );
  process.exit(2);
}

const folder = mkdtempSync(join(tmpdir(), "teneo-tjs-"));
const bundle = join(folder, "bundle.js");
try {
  // the flags tinyjs gives esbuild for the backend
  const built = spawnSync(
    esbuild,
    [
      entry,
      "--bundle",
      "--format=esm",
      "--platform=neutral",
      "--main-fields=module,main",
      "--external:tjs:*",
      "--log-level=warning",
      `--outfile=${bundle}`,
    ],
    { stdio: "inherit" },
  );
  if (built.status !== 0) process.exit(built.status ?? 1);
  const ran = spawnSync(tjs, ["run", bundle, ...args], { stdio: "inherit" });
  process.exitCode = ran.status ?? 1;
} finally {
  rmSync(folder, { recursive: true, force: true });
}
