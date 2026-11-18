// Signs and publishes the release CI left as a draft. Run on your Mac:
//   bun run release:publish [version]     (default: tinyjs.json's version)
// It checks that CI made every file of the draft and that the manifest points
// at those files, shows what is about to ship, then signs the manifest with
// the update key from 1Password (Touch ID) and publishes. The key is on disk
// only while tinyjs signs, in a folder only you can open.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  CI_LOGIN,
  checkDraft,
  type Manifest,
  publicKeysOf,
  type Release,
  UPDATE_KEY_VAULT,
  updateKeyReference,
  verifyManifest,
} from "./release-manifest.ts";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const result = spawnSync(command, args, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0)
    fail(`${command} ${args.slice(0, 2).join(" ")} failed`);
  return result.stdout;
}

const config = JSON.parse(readFileSync("tinyjs.json", "utf8")) as {
  version: string;
  update?: { publicKey?: unknown };
};
const version = process.argv[2] ?? config.version;
const tag = `v${version}`;
const beta = version.includes("-");
const publicKeys = publicKeysOf(config);
if (publicKeys.length === 0)
  fail("tinyjs.json has no update.publicKey. Run `bun run release:key` first.");
const keyReference =
  process.env.TENEO_UPDATE_KEY_REF ?? updateKeyReference(UPDATE_KEY_VAULT);
const tinyjsPath = join(homedir(), ".tinyjs", "tinyjs");
const tinyjs = existsSync(tinyjsPath) ? tinyjsPath : "tinyjs";

// --- the draft, and whether CI made all of it
const repository = run("gh", [
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "-q",
  ".nameWithOwner",
]).trim();
const releases = JSON.parse(
  run("gh", ["api", `repos/${repository}/releases?per_page=40`]),
) as (Release & {
  target_commitish: string;
})[];
const drafts = releases.filter((release) => release.tag_name === tag);
if (drafts.length === 0)
  fail(
    `There is no ${tag} on GitHub. CI makes the draft when the PR that bumps the version is merged.`,
  );
if (drafts.length > 1)
  fail(
    `There are ${drafts.length} releases tagged ${tag}. Delete the extra drafts on GitHub first.`,
  );
const [release] = drafts;
const manifestAsset = release.assets.find(
  (asset) => asset.name === "manifest.json",
);
if (!manifestAsset) fail(`${tag} has no manifest.json`);
const draftManifest = JSON.parse(
  run("gh", [
    "api",
    "-H",
    "Accept: application/octet-stream",
    `repos/${repository}/releases/assets/${manifestAsset.id}`,
  ]),
) as Manifest;

// a run that stopped after uploading the signed manifest picks up from there
const alreadySigned = draftManifest.signed !== undefined;
const manifest = alreadySigned
  ? await verifyManifest(draftManifest, publicKeys)
  : draftManifest;
const asCi = alreadySigned
  ? {
      ...release,
      assets: release.assets.map((asset) =>
        asset.name === "manifest.json"
          ? { ...asset, uploader: { login: CI_LOGIN } }
          : asset,
      ),
    }
  : release;
const problems = checkDraft(asCi, manifest, repository, version);
if (problems.length > 0)
  fail(`${tag} can't be published:\n  - ${problems.join("\n  - ")}`);

// --- GitHub's signed record that each file came from release.yml on main
const downloads = mkdtempSync(join(tmpdir(), "teneo-release-"));
process.on("exit", () => rmSync(downloads, { recursive: true, force: true }));
console.log("Checking each file's build provenance…");
run("gh", [
  "release",
  "download",
  tag,
  "--repo",
  repository,
  "--dir",
  downloads,
  "--pattern",
  "*.zip",
  "--pattern",
  "*.dmg",
]);
for (const asset of release.assets.filter((file) =>
  /\.(zip|dmg)$/.test(file.name),
)) {
  run("gh", [
    "attestation",
    "verify",
    join(downloads, asset.name),
    "--repo",
    repository,
    "--signer-workflow",
    `${repository}/.github/workflows/release.yml`,
    "--source-ref",
    "refs/heads/main",
    "--deny-self-hosted-runners",
  ]);
}

// --- what is about to ship
spawnSync(
  "git",
  ["fetch", "--quiet", "--tags", "origin", release.target_commitish],
  { stdio: "inherit" },
);
const previous = releases.find(
  (other) =>
    !other.draft &&
    other.tag_name.startsWith("v") &&
    other.prerelease === beta &&
    other.tag_name !== tag,
);
console.log(`\n${beta ? "Teneo Beta" : "Teneo"} ${version}, built by CI from:`);
console.log(
  `  ${run("git", ["log", "-1", "--format=%h %s (%an, %ar)", release.target_commitish]).trim()}`,
);
if (previous) {
  const commits = run("git", [
    "log",
    "--oneline",
    "--no-merges",
    `${previous.tag_name}..${release.target_commitish}`,
  ]);
  console.log(
    `\nChanges since ${previous.tag_name}:\n${commits.trim() || "  (none)"}`,
  );
}
console.log("\nFiles, all uploaded by CI:");
for (const asset of release.assets) {
  console.log(
    `  ${asset.name}  ${((asset.size ?? 0) / 1e6).toFixed(1)} MB  ${asset.digest?.slice(7, 19) ?? ""}…`,
  );
}
console.log(
  `\nRelease notes:\n  ${(manifest.notes ?? "").split("\n").slice(0, 8).join("\n  ")}\n`,
);

const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const answer = await prompt.question(
  `Type ${version} to sign and publish it: `,
);
prompt.close();
if (answer.trim() !== version) fail("Nothing was published.");

// --- sign, upload, publish
const folder = mkdtempSync(join(tmpdir(), "teneo-sign-"));
try {
  const manifestFile = join(folder, "manifest.json");
  writeFileSync(manifestFile, `${JSON.stringify(draftManifest, null, 2)}\n`);
  if (!alreadySigned) {
    const keyFile = join(folder, "update-key.der");
    console.log(
      "Reading the update key from 1Password. Approve with Touch ID.",
    );
    const key = run("op", ["read", "--no-newline", keyReference]);
    writeFileSync(keyFile, Buffer.from(key, "base64"), { mode: 0o600 });
    try {
      run(tinyjs, ["publish", "--sign-manifest", manifestFile], {
        ...process.env,
        TINYJS_UPDATE_PRIVATE_KEY_FILE: keyFile,
      });
    } finally {
      rmSync(keyFile, { force: true });
    }
    const payload = await verifyManifest(
      JSON.parse(readFileSync(manifestFile, "utf8")),
      publicKeys,
    );
    if (JSON.stringify(payload) !== JSON.stringify(manifest))
      fail("The signed manifest isn't the one CI made.");
    run("gh", [
      "release",
      "upload",
      tag,
      manifestFile,
      "--clobber",
      "--repo",
      repository,
    ]);
  }
  run("gh", [
    "release",
    "edit",
    tag,
    "--repo",
    repository,
    "--draft=false",
    ...(beta ? ["--prerelease", "--latest=false"] : ["--latest"]),
  ]);
  if (beta) {
    // Teneo Beta updates from this release, which holds only the newest beta's manifest
    if (!releases.some((other) => other.tag_name === "beta-channel")) {
      run("gh", [
        "release",
        "create",
        "beta-channel",
        "--repo",
        repository,
        "--target",
        release.target_commitish,
        "--title",
        "Teneo Beta update channel",
        "--notes",
        "Teneo Beta reads its updates from the manifest.json here. To install a beta, download it from its own release.",
        "--prerelease",
        "--latest=false",
      ]);
    }
    run("gh", [
      "release",
      "upload",
      "beta-channel",
      manifestFile,
      "--clobber",
      "--repo",
      repository,
    ]);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}

// --- what installed apps now see: a manifest this key signed, and downloads that work
const channelUrl = beta
  ? `https://github.com/${repository}/releases/download/beta-channel/manifest.json`
  : `https://github.com/${repository}/releases/latest/download/manifest.json`;
let live: Manifest | null = null;
for (let attempt = 0; attempt < 6 && live?.version !== version; attempt++) {
  if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 5000));
  const response = await fetch(channelUrl);
  if (response.ok)
    live = await verifyManifest(await response.json(), publicKeys).catch(
      () => null,
    );
}
if (live?.version !== version)
  fail(
    `Published, but ${channelUrl} doesn't offer a signed ${version} yet. Check it in a minute.`,
  );
for (const entry of Object.values(live.mac ?? {})) {
  const response = await fetch(entry.url, { method: "HEAD" });
  if (!response.ok)
    fail(`Published, but ${entry.url} answered ${response.status}.`);
}
console.log(
  `\n✓ ${beta ? "Teneo Beta" : "Teneo"} ${version} is published, and installed apps see its signed manifest.`,
);
