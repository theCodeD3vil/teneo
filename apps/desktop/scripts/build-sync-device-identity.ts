import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const macReleaseArchitectures = ["arm64", "x86_64"] as const;
export type MacReleaseArchitecture = (typeof macReleaseArchitectures)[number];
export const syncDeviceIdentityHelper = "teneo-sync-device-identity";

/** The helper is copied to Contents/Helpers and signed by TinyJS. */
export function buildSyncDeviceIdentity(): void {
  const cwd = fileURLToPath(new URL("../", import.meta.url));
  for (const arch of macReleaseArchitectures) {
    const directory = `executables/macos-${arch}`;
    mkdirSync(`${cwd}${directory}`, { recursive: true });
    const result = spawnSync(
      "xcrun",
      [
        "swiftc",
        "-O",
        "-target",
        `${arch}-apple-macos15.0`,
        "native/sync-device-identity.swift",
        "-o",
        `${directory}/${syncDeviceIdentityHelper}`,
      ],
      { cwd, stdio: "inherit" },
    );
    if (result.status !== 0)
      throw new Error(`Couldn't build the ${arch} sync identity helper`);
  }
}

if (import.meta.main) buildSyncDeviceIdentity();
