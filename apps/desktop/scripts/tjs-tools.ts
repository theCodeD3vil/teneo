// Bundle a backend file the way tinyjs bundles the backend, so the real txiki
// runtime can run it. Shared by the scripts that need `tjs:sqlite` and friends,
// which bun doesn't have.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const tjsBinary = join(homedir(), ".tinyjs/bin/tjs");

/** Bundle `entry` into `outfile`; throws with esbuild's complaint when it fails. */
export function bundleForTjs(entry: string, outfile: string): void {
  const esbuild = [
    "node_modules/.bin/esbuild",
    "../../node_modules/.bin/esbuild",
  ].find(existsSync);
  if (!existsSync(tjsBinary)) {
    throw new Error(`the tinyjs runtime is not at ${tjsBinary}`);
  }
  if (!esbuild) throw new Error("esbuild is not installed: run `bun install`");
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
      `--outfile=${outfile}`,
    ],
    { stdio: "inherit" },
  );
  if (built.status !== 0) throw new Error(`bundling ${entry} failed`);
}
