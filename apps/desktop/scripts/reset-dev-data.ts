// `bun run desktop:reset-dev-data`: forget everything a dev run kept. Quit
// Teneo Debug first. Only the dev copies go: the dev folders, the dev keys in
// store.json and the dev Keychain entries. A dev run is Teneo Debug, with an
// id of its own; before it had one, and with TENEO_REAL_DATA=1 still, its
// data sat inside the installed Teneo's, so that is cleared of dev copies too.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";

import { appIdentities } from "../backend/app-identity.ts";
import {
  appSecretNames,
  appStoreKeys,
  devFolder,
  devSuffix,
} from "../backend/dev-data.ts";

for (const id of [appIdentities.debug.id, appIdentities.production.id]) {
  resetDevData(id);
}

function resetDevData(id: string): void {
  const data = `${homedir()}/Library/Application Support/${id}`;
  const cache = `${homedir()}/Library/Caches/${id}`;

  for (const folder of [devFolder(data), devFolder(cache)]) {
    rmSync(folder, { recursive: true, force: true });
    console.log(`removed ${folder}`);
  }

  // the same file the real app uses, so only the dev keys are touched
  const storePath = `${data}/store.json`;
  if (existsSync(storePath)) {
    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<
      string,
      unknown
    >;
    const devKeys = appStoreKeys
      .map((key) => key + devSuffix)
      .filter((key) => key in store);
    for (const key of devKeys) delete store[key];
    if (devKeys.length > 0) {
      writeFileSync(`${storePath}.tmp`, `${JSON.stringify(store, null, 2)}\n`);
      renameSync(`${storePath}.tmp`, storePath);
    }
    console.log(`removed ${devKeys.length} dev key(s) from store.json`);
  }

  // macOS may ask for the Mac password here
  for (const name of appSecretNames) {
    const account = name + devSuffix;
    try {
      execFileSync(
        "security",
        ["delete-generic-password", "-s", id, "-a", account],
        { stdio: "pipe" },
      );
      console.log(`removed Keychain entry ${account}`);
    } catch (error) {
      // exit code 44: there was no such entry
      if ((error as { status?: number }).status !== 44) throw error;
      console.log(`no Keychain entry ${account}`);
    }
  }
}
