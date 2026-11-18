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

// set-release-identity.ts has already made tinyjs.json this release's app
const { name, title, version } = JSON.parse(
  readFileSync("tinyjs.json", "utf8"),
) as Record<string, string>;
mkdirSync(out, { recursive: true });

function run([command, ...args]: string[]): boolean {
  return spawnSync(command, args, { stdio: "inherit" }).status === 0;
}

const builds = [];
for (const arch of ["arm64", "x86_64"] as const) {
  // Apple's timestamp server, which codesign calls, drops the odd request
  if (
    !run(["tinyjs", "build", "--arch", arch, "--dmg"]) &&
    !run(["tinyjs", "build", "--arch", arch, "--dmg"])
  ) {
    throw new Error(`the ${arch} build failed`);
  }
  // each build empties dist/, so its disk image and zip move out first
  for (const file of readdirSync("dist").filter((entry) =>
    entry.endsWith(".dmg"),
  )) {
    renameSync(join("dist", file), join(out, file));
  }
  const zip = `${name}-${version}-macos-${arch}.zip`;
  if (
    !run([
      "ditto",
      "-c",
      "-k",
      "--keepParent",
      join("dist", `${title}.app`),
      join(out, zip),
    ])
  ) {
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
