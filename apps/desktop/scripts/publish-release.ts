// Signs and publishes the releases CI left as drafts. Run on your Mac:
//   bun run release:publish [version] [--android version]
// The Mac version defaults to tinyjs.json's, the Android one to
// apps/mobile/package.json's; each is published when CI left a draft of it.
// It waits for any release build still running on the drafts' commit, checks
// that CI made every file and that each manifest points at those files, shows
// what is about to ship (the release notes whole), then signs the manifests
// with the update key from 1Password (Touch ID) and publishes. The key is on
// disk only while tinyjs signs, in a folder only you can open.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { appSignatureProblems } from "./app-signature.ts";
import { ghArgs } from "./gh-command.ts";
import {
  ANDROID_MANIFEST,
  androidChannelFile,
  androidReleaseProblems,
  UPDATE_CHANNEL_TAG,
  ANDROID_TAG_PREFIX,
  type AndroidManifest,
  androidApkName,
  CI_LOGIN,
  checkAndroidDraft,
  checkDraft,
  type Manifest,
  parseAndroidManifest,
  publicKeysOf,
  type Release,
  signAndroidManifest,
  UPDATE_KEY_VAULT,
  updateKeyReference,
  verifyAndroidManifest,
  verifyManifest,
} from "./release-manifest.ts";
import { notesProblems } from "./release-notes.ts";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function run(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  // gh as the shell runs it (gh-command.ts)
  const [program, programArgs] =
    command === "gh" ? ghArgs(args) : [command, args];
  const result = spawnSync(program, programArgs, {
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0)
    fail(`${command} ${args.slice(0, 2).join(" ")} failed`);
  return result.stdout;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

const config = JSON.parse(readFileSync("tinyjs.json", "utf8")) as {
  version: string;
  update?: { publicKey?: unknown };
};
const positional = process.argv
  .slice(2)
  .filter(
    (arg, index, args) =>
      !arg.startsWith("--") && args[index - 1] !== "--android",
  );
const macVersion = positional[0] ?? config.version;
const androidVersion =
  option("--android") ??
  (
    JSON.parse(readFileSync("../mobile/package.json", "utf8")) as {
      version: string;
    }
  ).version;
const macTag = `v${macVersion}`;
const androidTag = `${ANDROID_TAG_PREFIX}${androidVersion}`;
const macBeta = macVersion.includes("-");
const publicKeys = publicKeysOf(config);
if (publicKeys.length === 0)
  fail("tinyjs.json has no update.publicKey. Run `bun run release:key` first.");
const keyReference =
  process.env.TENEO_UPDATE_KEY_REF ?? updateKeyReference(UPDATE_KEY_VAULT);
const tinyjsPath = join(homedir(), ".tinyjs", "tinyjs");
const tinyjs = existsSync(tinyjsPath) ? tinyjsPath : "tinyjs";

type DraftRelease = Release & {
  target_commitish: string;
  body?: string | null;
};

const repository = run("gh", [
  "repo",
  "view",
  "--json",
  "nameWithOwner",
  "-q",
  ".nameWithOwner",
]).trim();
const listReleases = () =>
  JSON.parse(
    run("gh", ["api", `repos/${repository}/releases?per_page=100`]),
  ) as DraftRelease[];

function draftOf(releases: DraftRelease[], tag: string): DraftRelease | null {
  const found = releases.filter((release) => release.tag_name === tag);
  if (found.length > 1)
    fail(
      `There are ${found.length} releases tagged ${tag}. Delete the extra drafts on GitHub first.`,
    );
  return found[0]?.draft ? found[0] : null;
}

function downloadAsset(release: Release, name: string): unknown {
  const asset = release.assets.find((candidate) => candidate.name === name);
  if (!asset) return null;
  return JSON.parse(
    run("gh", [
      "api",
      "-H",
      "Accept: application/octet-stream",
      `repos/${repository}/releases/assets/${asset.id}`,
    ]),
  );
}

// --- wait for the release builds of the drafts' commit
// The Android build adds its APK to the Mac draft, and a published release is
// locked: publishing the Mac draft before that build is done would fail it.
const RELEASE_WORKFLOWS = [
  ".github/workflows/release.yml",
  ".github/workflows/release-android.yml",
];
async function waitForReleaseBuilds(commits: string[]): Promise<void> {
  const deadline = Date.now() + 45 * 60_000;
  let told = false;
  for (;;) {
    const running = commits.flatMap((sha) =>
      (
        JSON.parse(
          run("gh", [
            "api",
            `repos/${repository}/actions/runs?head_sha=${sha}&per_page=50`,
          ]),
        ) as { workflow_runs: { name: string; path: string; status: string }[] }
      ).workflow_runs.filter(
        (workflow) =>
          RELEASE_WORKFLOWS.includes(workflow.path) &&
          workflow.status !== "completed",
      ),
    );
    if (running.length === 0) return;
    if (Date.now() > deadline)
      fail(
        `${running.map((workflow) => workflow.name).join(" and ")} still hasn't finished. Run this again once it has.`,
      );
    if (!told) {
      console.log(
        `Waiting for ${running.map((workflow) => workflow.name).join(" and ")} to finish on this commit…`,
      );
      told = true;
    }
    await sleep(20_000);
  }
}

let releases = listReleases();
{
  const pending = [draftOf(releases, macTag), draftOf(releases, androidTag)]
    .filter((release) => release !== null)
    .map((release) => release.target_commitish);
  if (pending.length === 0)
    fail(
      `There is no draft of ${macTag} or ${androidTag} on GitHub. CI makes one when the PR that bumps a version is merged.`,
    );
  await waitForReleaseBuilds([...new Set(pending)]);
  releases = listReleases(); // the builds may have added files since
}
const macDraft = draftOf(releases, macTag);
const androidDraft = draftOf(releases, androidTag);

// --- the Mac draft, and whether CI made all of it
interface MacPlan {
  release: DraftRelease;
  draftManifest: Manifest;
  manifest: Manifest;
  alreadySigned: boolean;
  /** The APK's manifest in this release, when the PR shipped Android too */
  android: { manifest: AndroidManifest; alreadySigned: boolean } | null;
}

/** The Mac draft's android-manifest.json: CI's, naming the APK beside it,
 *  of this Android version. Phones from 0.1.3 update from it. */
async function planMainAndroid(
  release: DraftRelease,
): Promise<MacPlan["android"]> {
  const doc = downloadAsset(release, ANDROID_MANIFEST);
  if (!doc) return null;
  const alreadySigned =
    typeof doc === "object" && doc !== null && "signed" in doc;
  const manifest = alreadySigned
    ? await verifyAndroidManifest(doc, publicKeys)
    : parseAndroidManifest(doc);
  if (!manifest)
    fail(`${macTag}'s ${ANDROID_MANIFEST} isn't CI's plain manifest`);
  const problems = androidReleaseProblems(
    release,
    manifest,
    repository,
    androidVersion,
  );
  for (const asset of release.assets) {
    const fromCi = asset.uploader?.login === CI_LOGIN;
    if (asset.name === ANDROID_MANIFEST && !fromCi && !alreadySigned)
      problems.push(`${ANDROID_MANIFEST} wasn't uploaded by CI`);
  }
  if (problems.length > 0)
    fail(
      `${macTag}'s Android app can't be published:\n  - ${problems.join("\n  - ")}`,
    );
  return { manifest, alreadySigned };
}
async function planMac(release: DraftRelease): Promise<MacPlan> {
  const draftManifest = downloadAsset(
    release,
    "manifest.json",
  ) as Manifest | null;
  if (!draftManifest) fail(`${macTag} has no manifest.json`);
  // a run that stopped after uploading the signed manifest picks up from there
  const alreadySigned = draftManifest.signed !== undefined;
  const manifest = alreadySigned
    ? await verifyManifest(draftManifest, publicKeys)
    : draftManifest;
  const android = await planMainAndroid(release);
  let asCi = alreadySigned
    ? withSignedFileFromCi(release, "manifest.json")
    : release;
  if (android?.alreadySigned)
    asCi = withSignedFileFromCi(asCi, ANDROID_MANIFEST);
  const problems = checkDraft(asCi, manifest, repository, macVersion);
  const notes = notesProblems(manifest.notes ?? "");
  if (notes.length > 0)
    problems.push(
      ...notes.map((problem) => `the release notes carry ${problem}`),
    );
  if (problems.length > 0)
    fail(`${macTag} can't be published:\n  - ${problems.join("\n  - ")}`);
  return { release, draftManifest, manifest, alreadySigned, android };
}

// --- the Android draft, and whether CI made all of it
interface AndroidPlan {
  release: DraftRelease;
  manifest: AndroidManifest;
  alreadySigned: boolean;
}
async function planAndroid(release: DraftRelease): Promise<AndroidPlan> {
  const doc = downloadAsset(release, ANDROID_MANIFEST);
  if (!doc) fail(`${androidTag} has no ${ANDROID_MANIFEST}`);
  const alreadySigned =
    typeof doc === "object" && doc !== null && "signed" in doc;
  const manifest = alreadySigned
    ? await verifyAndroidManifest(doc, publicKeys)
    : parseAndroidManifest(doc);
  const problems = checkAndroidDraft(
    alreadySigned ? withSignedFileFromCi(release, ANDROID_MANIFEST) : release,
    manifest,
    repository,
    androidVersion,
  );
  if (problems.length > 0 || !manifest)
    fail(`${androidTag} can't be published:\n  - ${problems.join("\n  - ")}`);
  return { release, manifest, alreadySigned };
}

/** The maintainer uploads the signed manifest; everything else must be CI's. */
function withSignedFileFromCi<T extends Release>(release: T, name: string): T {
  return {
    ...release,
    assets: release.assets.map((asset) =>
      asset.name === name ? { ...asset, uploader: { login: CI_LOGIN } } : asset,
    ),
  };
}

const mac = macDraft ? await planMac(macDraft) : null;
const android = androidDraft ? await planAndroid(androidDraft) : null;

// --- GitHub's signed record that each file came from its workflow on main
const downloads = mkdtempSync(join(tmpdir(), "teneo-release-"));
process.on("exit", () => rmSync(downloads, { recursive: true, force: true }));
function verifyProvenance(
  release: Release,
  pattern: RegExp,
  workflow: string,
): void {
  const files = release.assets.filter((file) => pattern.test(file.name));
  if (files.length === 0) return;
  const folder = mkdtempSync(join(downloads, "files-"));
  run("gh", [
    "release",
    "download",
    release.tag_name,
    "--repo",
    repository,
    "--dir",
    folder,
    ...files.flatMap((file) => ["--pattern", file.name]),
  ]);
  for (const file of files) {
    run("gh", [
      "attestation",
      "verify",
      join(folder, file.name),
      "--repo",
      repository,
      "--signer-workflow",
      `${repository}/${workflow}`,
      "--source-ref",
      "refs/heads/main",
      "--deny-self-hosted-runners",
    ]);
    const sha256 = createHash("sha256")
      .update(readFileSync(join(folder, file.name)))
      .digest("hex");
    if (file.digest !== `sha256:${sha256}`)
      fail(`${file.name} downloaded isn't the file GitHub's digest describes.`);
    // what each Mac will run: hardened, with nothing loosening it
    if (file.name.endsWith(".zip")) {
      const unpacked = mkdtempSync(join(folder, "app-"));
      run("ditto", ["-x", "-k", join(folder, file.name), unpacked]);
      const app = readdirSync(unpacked).find((entry) => entry.endsWith(".app"));
      if (!app) fail(`${file.name} holds no app`);
      const problems = appSignatureProblems(join(unpacked, app));
      if (problems.length > 0)
        fail(
          `${file.name}'s app is signed wrong:\n  - ${problems.join("\n  - ")}`,
        );
    }
  }
}
console.log("Checking each file's build provenance…");
if (mac) {
  verifyProvenance(
    mac.release,
    /\.(zip|dmg)$/,
    ".github/workflows/release.yml",
  );
  verifyProvenance(
    mac.release,
    /\.apk$/,
    ".github/workflows/release-android.yml",
  );
}
if (android) {
  verifyProvenance(
    android.release,
    /\.apk$/,
    ".github/workflows/release-android.yml",
  );
}

// --- what is about to ship
spawnSync(
  "git",
  [
    "fetch",
    "--quiet",
    "--tags",
    "origin",
    ...new Set(
      [mac, android].flatMap((plan) => plan?.release.target_commitish ?? []),
    ),
  ],
  { stdio: "inherit" },
);
const indent = (text: string) => `  ${text.split("\n").join("\n  ")}`;

if (mac) {
  const { release, manifest } = mac;
  const previous = releases.find(
    (other) =>
      !other.draft &&
      other.tag_name.startsWith("v") &&
      other.prerelease === macBeta &&
      other.tag_name !== macTag,
  );
  console.log(
    `\n${macBeta ? "Teneo Beta" : "Teneo"} ${macVersion}, built by CI from:`,
  );
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
  // whole: every line of it is shown in the update window of every Mac
  console.log(
    `\nRelease notes, as installed Macs will show them:\n${indent(manifest.notes ?? "(none)")}\n`,
  );
}

if (android) {
  const { release, manifest } = android;
  console.log(
    `\nTeneo for Android ${androidVersion} (${manifest.package}, version code ${manifest.versionCode}), built by CI from:`,
  );
  console.log(
    `  ${run("git", ["log", "-1", "--format=%h %s (%an, %ar)", release.target_commitish]).trim()}`,
  );
  console.log(
    `  ${androidApkName(androidVersion)}  ${(manifest.apk.size / 1e6).toFixed(1)} MB  ${manifest.apk.sha256.slice(0, 12)}…`,
  );
  const body = release.body?.trim() ?? "";
  if (!mac || body !== (mac.manifest.notes ?? "").trim())
    console.log(`\nRelease notes:\n${indent(body || "(none)")}\n`);
}

const confirmation = [mac && macVersion, android && androidVersion]
  .filter(Boolean)
  .join(" ");
const prompt = createInterface({
  input: process.stdin,
  output: process.stdout,
});
const answer = await prompt.question(
  `Type ${confirmation} to sign and publish: `,
);
prompt.close();
if (answer.trim() !== confirmation) fail("Nothing was published.");

// --- sign, upload, publish
const folder = mkdtempSync(join(tmpdir(), "teneo-sign-"));
let macManifestFile = "";
try {
  // read once: one Touch ID for everything this run signs
  const needsKey =
    (mac !== null && !mac.alreadySigned) ||
    (mac?.android != null && !mac.android.alreadySigned) ||
    (android !== null && !android.alreadySigned);
  const signingKey = () =>
    crypto.subtle.importKey(
      "pkcs8",
      Buffer.from(key, "base64"),
      "Ed25519",
      false,
      ["sign"],
    );
  /** Sign an Android manifest, check the signature, and upload it to `tag` */
  async function signAndroidInto(
    manifest: AndroidManifest,
    tag: string,
  ): Promise<void> {
    const signed = await signAndroidManifest(manifest, await signingKey());
    const payload = await verifyAndroidManifest(signed, publicKeys);
    if (JSON.stringify(payload) !== JSON.stringify(manifest))
      fail(`The signed Android manifest for ${tag} isn't the one CI made.`);
    const file = join(mkdtempSync(join(folder, "android-")), ANDROID_MANIFEST);
    writeFileSync(file, `${JSON.stringify(signed, null, 2)}\n`);
    run("gh", [
      "release",
      "upload",
      tag,
      file,
      "--clobber",
      "--repo",
      repository,
    ]);
  }
  const key = needsKey
    ? (console.log(
        "Reading the update key from 1Password. Approve with Touch ID.",
      ),
      run("op", ["read", "--no-newline", keyReference]))
    : "";

  if (mac) {
    macManifestFile = join(folder, "manifest.json");
    writeFileSync(
      macManifestFile,
      `${JSON.stringify(mac.draftManifest, null, 2)}\n`,
    );
    if (!mac.alreadySigned) {
      const keyFile = join(folder, "update-key.der");
      writeFileSync(keyFile, Buffer.from(key, "base64"), { mode: 0o600 });
      try {
        run(tinyjs, ["publish", "--sign-manifest", macManifestFile], {
          ...process.env,
          TINYJS_UPDATE_PRIVATE_KEY_FILE: keyFile,
        });
      } finally {
        rmSync(keyFile, { force: true });
      }
      const payload = await verifyManifest(
        JSON.parse(readFileSync(macManifestFile, "utf8")),
        publicKeys,
      );
      if (JSON.stringify(payload) !== JSON.stringify(mac.manifest))
        fail("The signed manifest isn't the one CI made.");
      run("gh", [
        "release",
        "upload",
        macTag,
        macManifestFile,
        "--clobber",
        "--repo",
        repository,
      ]);
    }
  }

  // the APK's manifest in Teneo's release, before that release is published
  if (mac?.android && !mac.android.alreadySigned)
    await signAndroidInto(mac.android.manifest, macTag);
  if (android && !android.alreadySigned)
    await signAndroidInto(android.manifest, androidTag);

  if (mac) {
    run("gh", [
      "release",
      "edit",
      macTag,
      "--repo",
      repository,
      "--draft=false",
      ...(macBeta ? ["--prerelease", "--latest=false"] : ["--latest"]),
    ]);
    if (macBeta) {
      // Teneo Beta updates from this release, which holds only the newest beta's manifest
      if (!releases.some((other) => other.tag_name === UPDATE_CHANNEL_TAG)) {
        run("gh", [
          "release",
          "create",
          UPDATE_CHANNEL_TAG,
          "--repo",
          repository,
          "--target",
          mac.release.target_commitish,
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
        UPDATE_CHANNEL_TAG,
        macManifestFile,
        "--clobber",
        "--repo",
        repository,
      ]);
    }
  }

  if (android) {
    run("gh", [
      "release",
      "edit",
      androidTag,
      "--repo",
      repository,
      "--draft=false",
      "--latest=false",
      ...(androidVersion.includes("-") ? ["--prerelease"] : []),
    ]);
  }

  // Last: the channel, which phones from 0.1.3 read, now that both releases
  // are published. Its manifest is the one in Teneo's release when the PR
  // shipped both apps, and the Android app's own release's when it didn't.
  if (android) {
    const from = mac?.android ? macTag : androidTag;
    const published = JSON.parse(
      run("gh", ["api", `repos/${repository}/releases/tags/${from}`]),
    ) as Release;
    const signed = downloadAsset(published, ANDROID_MANIFEST);
    const payload = await verifyAndroidManifest(signed, publicKeys);
    if (payload.version !== androidVersion)
      fail(
        `${from}'s ${ANDROID_MANIFEST} offers ${payload.version}, not ${androidVersion}.`,
      );
    if (!releases.some((other) => other.tag_name === UPDATE_CHANNEL_TAG))
      run("gh", [
        "release",
        "create",
        UPDATE_CHANNEL_TAG,
        "--repo",
        repository,
        "--target",
        android.release.target_commitish,
        "--title",
        "Teneo update channel",
        "--notes",
        "Teneo's apps read their updates from the signed manifests here. To install Teneo, download it from its own release.",
        "--prerelease",
        "--latest=false",
      ]);
    const channelFile = join(
      mkdtempSync(join(folder, "channel-")),
      androidChannelFile(androidVersion),
    );
    writeFileSync(channelFile, `${JSON.stringify(signed, null, 2)}\n`);
    run("gh", [
      "release",
      "upload",
      UPDATE_CHANNEL_TAG,
      channelFile,
      "--clobber",
      "--repo",
      repository,
    ]);
  }
} finally {
  rmSync(folder, { recursive: true, force: true });
}

// --- what installed apps now see: manifests this key signed, and downloads that work
async function liveManifest<T>(
  url: string,
  verify: (doc: unknown) => Promise<T & { version: string }>,
  version: string,
): Promise<T & { version: string }> {
  let live: (T & { version: string }) | null = null;
  for (let attempt = 0; attempt < 6 && live?.version !== version; attempt++) {
    if (attempt > 0) await sleep(5000);
    const response = await fetch(url);
    if (response.ok)
      live = await verify(await response.json()).catch(() => null);
  }
  if (live?.version !== version)
    fail(
      `Published, but ${url} doesn't offer a signed ${version} yet. Check it in a minute.`,
    );
  return live;
}
async function checkDownload(url: string): Promise<void> {
  const response = await fetch(url, { method: "HEAD" });
  if (!response.ok) fail(`Published, but ${url} answered ${response.status}.`);
}

if (mac) {
  const channelUrl = macBeta
    ? `https://github.com/${repository}/releases/download/beta-channel/manifest.json`
    : `https://github.com/${repository}/releases/latest/download/manifest.json`;
  const live = await liveManifest(
    channelUrl,
    (doc) => verifyManifest(doc, publicKeys),
    macVersion,
  );
  for (const entry of Object.values(live.mac ?? {}))
    await checkDownload(entry.url);
  console.log(
    `\n✓ ${macBeta ? "Teneo Beta" : "Teneo"} ${macVersion} is published, and installed apps see its signed manifest.`,
  );
}
if (android) {
  // what phones from 0.1.3 read (UpdateRules.channelUrl in the Android app)
  const live = await liveManifest(
    `https://github.com/${repository}/releases/download/${UPDATE_CHANNEL_TAG}/${androidChannelFile(androidVersion)}`,
    (doc) => verifyAndroidManifest(doc, publicKeys),
    androidVersion,
  );
  await checkDownload(live.apk.url);
  console.log(
    `\n✓ Teneo for Android ${androidVersion} is published, and phones see its signed manifest.`,
  );
}
