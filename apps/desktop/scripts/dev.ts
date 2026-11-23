// `bun run desktop`: `tinyjs dev` as Teneo Debug, an app of its own beside an
// installed Teneo or Teneo Beta. tinyjs.json carries the debug name and id
// while this runs and gets the full release's back when it ends, so what is
// committed is always Teneo. Anything else changed in the file meanwhile, a
// version bump say, is kept.
import { spawn } from "node:child_process";

import { writeAppIdentity } from "./app-config.ts";
import { buildSyncDeviceIdentity } from "./build-sync-device-identity.ts";
import { prepareTinyjs } from "./tinyjs-keychain.ts";

buildSyncDeviceIdentity();
const tinyjsTool = prepareTinyjs([
  process.arch === "arm64" ? "arm64" : "x86_64",
]);
process.on("exit", tinyjsTool.dispose);

// TENEO_REAL_DATA=1 runs on the installed Teneo's data, which is under its id
writeAppIdentity("debug", { keepId: process.env.TENEO_REAL_DATA === "1" });

let isRestored = false;
function restore(): void {
  if (isRestored) return;
  isRestored = true;
  writeAppIdentity("production");
}

const tinyjs = spawn(tinyjsTool.binary, ["dev", ...process.argv.slice(2)], {
  stdio: "inherit",
});
// Ctrl-C reaches tinyjs too, as it is in the same terminal: wait for it to
// end. The other signals come to this process alone, so pass them on.
process.on("SIGINT", () => {});
for (const signal of ["SIGTERM", "SIGHUP"] as const) {
  process.on(signal, () => tinyjs.kill(signal));
}
process.on("exit", restore);
tinyjs.on("error", (error) => {
  restore();
  throw error;
});
tinyjs.on("exit", (code) => {
  restore();
  process.exit(code ?? 1);
});
