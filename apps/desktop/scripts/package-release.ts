// Builds the Mac release in CI: both CPUs' apps, disk images and zips, and a
// plain manifest.json pointing at this release's zips. `tinyjs publish`
// would sign the manifest, which needs the private update key; CI never has
// it. The maintainer signs on their Mac (scripts/publish-release.ts).
//   bun scripts/package-release.ts --notes-file NOTES --out DIR
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  appSignatureProblems,
  isSigningCertificateHash,
} from "./app-signature.ts";
import {
  buildSyncDeviceIdentity,
  macReleaseArchitectures,
} from "./build-sync-device-identity.ts";
import { buildManifest } from "./release-manifest.ts";

const option = (name: string) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`${name} is required`);
  return value;
};
const out = option("--out");
const notes = readFileSync(option("--notes-file"), "utf8").trim();
const repository = process.env.GITHUB_REPOSITORY;
if (!repository) throw new Error("GITHUB_REPOSITORY is not set");
const identity = process.env.TINYJS_SIGN_IDENTITY;
if (!isSigningCertificateHash(identity))
  throw new Error(
    "TINYJS_SIGN_IDENTITY must be the release certificate SHA-1 fingerprint",
  );

// set-release-identity.ts has already made tinyjs.json this release's app
const { name, title, version } = JSON.parse(
  readFileSync("tinyjs.json", "utf8"),
) as Record<string, string>;
mkdirSync(out, { recursive: true });

// TinyJS copies each architecture's compiled helper from executables/ into
// Contents/Helpers and signs it as nested code before sealing the bundle.
buildSyncDeviceIdentity();

function run([command, ...args]: string[]): boolean {
  return spawnSync(command, args, { stdio: "inherit" }).status === 0;
}

const builds = [];
for (const arch of macReleaseArchitectures) {
  // Apple's timestamp server, which codesign calls, drops the odd request
  if (
    !run(["tinyjs", "build", "--arch", arch, "--dmg"]) &&
    !run(["tinyjs", "build", "--arch", arch, "--dmg"])
  ) {
    throw new Error(`the ${arch} build failed`);
  }
  // the hardened runtime is what keeps other software out of a self-signed app
  const app = join("dist", `${title}.app`);
  const problems = appSignatureProblems(app, { arch, identity });
  if (problems.length > 0) {
    throw new Error(
      `the ${arch} app's signature is wrong:\n  - ${problems.join("\n  - ")}`,
    );
  }
  // Move out only disk images made from a bundle that has passed validation.
  // The next architecture's build empties dist/.
  for (const file of readdirSync("dist").filter((entry) =>
    entry.endsWith(".dmg"),
  )) {
    renameSync(join("dist", file), join(out, file));
  }
  const zip = `${name}-${version}-macos-${arch}.zip`;
  if (!run(["ditto", "-c", "-k", "--keepParent", app, join(out, zip)])) {
    throw new Error(`zipping the ${arch} app failed`);
  }
  const sha256 = createHash("sha256")
    .update(readFileSync(join(out, zip)))
    .digest("hex");
  builds.push({ arch, zip, sha256 });
}

const manifest = buildManifest({ version, repository, notes, builds });
writeFileSync(
  join(out, "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(
  `${title} ${version}: ${builds.map((build) => build.zip).join(", ")}, disk images and an unsigned manifest.json in ${out}`,
);
