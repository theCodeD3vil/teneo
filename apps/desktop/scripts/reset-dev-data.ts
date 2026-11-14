// `bun run desktop:reset-dev-data`: forget everything `tinyjs dev` kept apart
// from the installed app. Quit Teneo first. Only the dev copies go: the dev
// folders, the dev keys in store.json and the dev Keychain entries.
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

import {
  appSecretNames,
  appStoreKeys,
  devFolder,
  devSuffix,
} from "../backend/dev-data.ts";

const { id } = JSON.parse(readFileSync("tinyjs.json", "utf8")) as {
  id: string;
};
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
