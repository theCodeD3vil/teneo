// Writes the plain android-manifest.json for an APK CI just built, for the
// maintainer to check and sign with `bun run release:publish`:
//   bun scripts/android-manifest.ts --version V --apk FILE --repository OWNER/REPO --out FILE
/* oxlint-disable no-console -- a command-line script reports on the console */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

import { buildAndroidManifest } from "./release-manifest.ts";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  if (!value) {
    console.error(`missing ${name}`);
    process.exit(2);
  }
  return value;
}

const apk = readFileSync(option("--apk"));
const manifest = buildAndroidManifest({
  version: option("--version"),
  repository: option("--repository"),
  size: apk.length,
  sha256: createHash("sha256").update(apk).digest("hex"),
});
writeFileSync(option("--out"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `android-manifest.json for ${manifest.package} ${manifest.version}`,
);
