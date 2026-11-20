// Teneo's update manifests and the rules every release must meet.
//
// CI builds a release as a draft with a plain manifest.json (buildManifest).
// The maintainer's Mac checks that draft (checkDraft), signs the manifest
// with the update key kept in 1Password, and publishes it. The watchdog
// checks every published release (checkPublishedRelease). Installed apps
// accept only manifests signed with a key in tinyjs.json's update.publicKey.
//
// The signed envelope is TinyJS's (~/.tinyjs/runtime/update-signing.js):
// { ...plain fields, signed: { format, algorithm, payload, signature } },
// where the Ed25519 signature covers "tinyjs-update-v1\n" + payload.
//
// Android releases work the same way with their own manifest,
// android-manifest.json, signed with the same key under another prefix
// ("teneo-android-update-v1\n"), so neither kind of signature can stand in for
// the other. The phone checks it (UpdateRules.java) before it downloads.

export const CI_LOGIN = "github-actions[bot]";

/** The 1Password item holding the private update key (scripts/create-update-key.ts). */
export const UPDATE_KEY_TITLE = "Teneo update signing key";
export const UPDATE_KEY_VAULT = "Personal";
/** The secrets CI signs with, kept as fields of one 1Password item (scripts/set-signing-secrets.ts). */
export const SIGNING_ITEM_TITLE = "Teneo signing secrets";
export const SIGNING_SECRETS = [
  "MACOS_CERTIFICATE_P12",
  "MACOS_CERTIFICATE_PASSWORD",
  "ANDROID_KEYSTORE_P12",
  "ANDROID_KEYSTORE_PASSWORD",
  // the old Android key's proof that the new one replaces it (base64)
  "ANDROID_SIGNING_LINEAGE",
];
/** Copied too when the 1Password item has them; a release builds without
 *  them. SENTRY_AUTH_TOKEN uploads the source maps of each build. */
export const OPTIONAL_SECRETS = ["SENTRY_AUTH_TOKEN"];
export const updateKeyReference = (vault: string) =>
  `op://${vault}/${UPDATE_KEY_TITLE}/password`;

/** Mac releases published from here on must be signed (the watchdog's line). */
export const SIGNED_FROM = "2026-11-18T00:00:00Z";
/** Android releases published from here on must carry a signed android-manifest.json. */
export const ANDROID_SIGNED_FROM = "2026-11-20T00:00:00Z";
export const ANDROID_MANIFEST = "android-manifest.json";
export const ANDROID_TAG_PREFIX = "android-v";
/** The release that holds what installed apps update from: Teneo Beta's Mac
 *  manifest.json, and each Android app's signed manifest (below) */
export const UPDATE_CHANNEL_TAG = "beta-channel";
export const ANDROID_BETA_MANIFEST = "android-beta-manifest.json";
/** The file in the update channel that phones with this version's app read
 *  (UpdateRules.channelUrl in the Android app) */
export const androidChannelFile = (version: string) =>
  version.includes("-beta.") ? ANDROID_BETA_MANIFEST : ANDROID_MANIFEST;
const ANDROID_FORMAT = "teneo-android-update-v1";

const SIGNATURE_PREFIX = "tinyjs-update-v1\n";
const ARCHES = ["arm64", "x86_64"] as const;
const MANIFEST_FIELDS = new Set(["version", "mac", "url", "sha256", "notes"]);

export interface ManifestEntry {
  url: string;
  sha256: string;
}

export interface Manifest {
  version: string;
  mac?: Partial<Record<(typeof ARCHES)[number], ManifestEntry>>;
  url?: string;
  sha256?: string;
  notes?: string;
  signed?: unknown;
  [field: string]: unknown;
}

/** A release as the GitHub REST API returns it, the fields used here. */
export interface Release {
  id: number;
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  author: { login: string } | null;
  assets: ReleaseAsset[];
}

export interface ReleaseAsset {
  id: number;
  name: string;
  size?: number;
  digest: string | null;
  updated_at: string;
  uploader: { login: string } | null;
}

/** The keys an app trusts, from tinyjs.json. */
export function publicKeysOf(config: {
  update?: { publicKey?: unknown };
}): string[] {
  const value = config.update?.publicKey;
  if (value === undefined || value === null || value === "") return [];
  const keys = Array.isArray(value) ? value : [value];
  // a malformed entry fails verification instead of being skipped, as in TinyJS
  return keys.map((key) => (typeof key === "string" ? key : ""));
}

function strictBase64(
  value: unknown,
  length: number,
  what: string,
): Uint8Array {
  if (typeof value !== "string") throw new Error(`invalid ${what}`);
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (
    bytes.length !== length ||
    Buffer.from(bytes).toString("base64") !== value
  )
    throw new Error(`invalid ${what}`);
  return bytes;
}

/** The signed payload text of an envelope in `format`, once its signature
 *  checks out against one of the keys. */
async function verifiedPayload(
  doc: unknown,
  publicKeys: string[],
  format: string,
): Promise<string> {
  if (publicKeys.length === 0)
    throw new Error("tinyjs.json has no update.publicKey");
  const envelope = (doc as { signed?: Record<string, unknown> } | null)?.signed;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.format !== format ||
    envelope.algorithm !== "Ed25519" ||
    typeof envelope.payload !== "string" ||
    Object.keys(envelope).sort().join(",") !==
      "algorithm,format,payload,signature"
  ) {
    throw new Error("the manifest isn't signed");
  }
  const signature = strictBase64(envelope.signature, 64, "signature");
  const keys = publicKeys.map((key) =>
    strictBase64(key, 32, "update public key"),
  );
  const message = new TextEncoder().encode(`${format}\n${envelope.payload}`);
  for (const raw of keys) {
    const key = await crypto.subtle.importKey("raw", raw, "Ed25519", false, [
      "verify",
    ]);
    if (await crypto.subtle.verify("Ed25519", key, signature, message))
      return envelope.payload;
  }
  throw new Error("the manifest's signature doesn't match Teneo's update key");
}

/** The signed payload, once its signature checks out against one of the keys. */
export async function verifyManifest(
  doc: unknown,
  publicKeys: string[],
): Promise<Manifest> {
  const payload = JSON.parse(
    await verifiedPayload(doc, publicKeys, "tinyjs-update-v1"),
  ) as Manifest;
  if (typeof payload?.version !== "string")
    throw new Error("the signed manifest has no version");
  return payload;
}

async function signedEnvelope(
  format: string,
  payload: string,
  privateKey: Parameters<typeof crypto.subtle.sign>[1],
) {
  const message = new TextEncoder().encode(`${format}\n${payload}`);
  const signature = Buffer.from(
    await crypto.subtle.sign("Ed25519", privateKey, message),
  ).toString("base64");
  return { format, algorithm: "Ed25519", payload, signature };
}

/** Sign as TinyJS does. Tests use it; releases are signed by `tinyjs publish --sign-manifest`. */
export async function signManifest(
  manifest: Manifest,
  privateKey: Parameters<typeof crypto.subtle.sign>[1],
): Promise<Manifest> {
  const { signed: _old, ...plain } = manifest;
  const payload = JSON.stringify(plain);
  return {
    ...plain,
    signed: await signedEnvelope(SIGNATURE_PREFIX.trim(), payload, privateKey),
  };
}

export function releaseDownloadUrl(
  repository: string,
  version: string,
  file: string,
): string {
  return `https://github.com/${repository}/releases/download/v${version}/${file}`;
}

/** CI's plain manifest: both Mac builds, pinned to this release's tag. */
export function buildManifest(options: {
  version: string;
  repository: string;
  notes?: string;
  builds: { arch: (typeof ARCHES)[number]; zip: string; sha256: string }[];
}): Manifest {
  const mac: NonNullable<Manifest["mac"]> = {};
  for (const build of options.builds) {
    mac[build.arch] = {
      url: releaseDownloadUrl(options.repository, options.version, build.zip),
      sha256: build.sha256,
    };
  }
  if (!mac.arm64 || !mac.x86_64)
    throw new Error("the manifest needs an arm64 and an x86_64 build");
  // apps from before per-CPU manifests read the top-level url, and all of them are Apple Silicon
  return {
    version: options.version,
    mac,
    url: mac.arm64.url,
    sha256: mac.arm64.sha256,
    ...(options.notes ? { notes: options.notes } : {}),
  };
}

function digestOf(asset: ReleaseAsset): string | null {
  return asset.digest?.startsWith("sha256:")
    ? asset.digest.slice(7).toLowerCase()
    : null;
}

/** Every way the manifest's downloads fail to be this release's own files. */
function downloadProblems(
  release: Release,
  manifest: Manifest,
  repository: string,
  version: string,
): string[] {
  const problems: string[] = [];
  for (const field of Object.keys(manifest)) {
    if (field !== "signed" && !MANIFEST_FIELDS.has(field))
      problems.push(`the manifest has an unexpected field "${field}"`);
  }
  if (manifest.version !== version)
    problems.push(`the manifest says ${manifest.version}, not ${version}`);
  for (const arch of ARCHES) {
    const entry = manifest.mac?.[arch];
    if (!entry) {
      problems.push(`the manifest has no ${arch} build`);
      continue;
    }
    const name = entry.url.slice(entry.url.lastIndexOf("/") + 1);
    const asset = release.assets.find((candidate) => candidate.name === name);
    if (entry.url !== releaseDownloadUrl(repository, version, name) || !asset) {
      problems.push(
        `the ${arch} download isn't a file of this release: ${entry.url}`,
      );
    } else if (digestOf(asset) !== entry.sha256.toLowerCase()) {
      problems.push(`${name} isn't the file the manifest's hash describes`);
    }
  }
  if (
    manifest.url !== manifest.mac?.arm64?.url ||
    manifest.sha256 !== manifest.mac?.arm64?.sha256
  ) {
    problems.push("the manifest's top-level download isn't its arm64 build");
  }
  return problems;
}

/** Problems with a draft before it is signed. None means CI made all of it. */
export function checkDraft(
  release: Release,
  manifest: Manifest,
  repository: string,
  version: string,
): string[] {
  const problems: string[] = [];
  if (!release.draft) problems.push(`v${version} is already published`);
  if (release.author?.login !== CI_LOGIN)
    problems.push(
      `the draft was made by ${release.author?.login ?? "nobody"}, not CI`,
    );
  for (const asset of release.assets) {
    if (asset.uploader?.login !== CI_LOGIN)
      problems.push(
        `${asset.name} was uploaded by ${asset.uploader?.login ?? "nobody"}, not CI`,
      );
  }
  if (manifest.signed !== undefined)
    problems.push("the draft's manifest is already signed");
  return [
    ...problems,
    ...downloadProblems(release, manifest, repository, version),
  ];
}

// --- Android

/** What an Android release's signed manifest vouches for. The phone installs
 *  only this APK, of this app, at this version. */
export interface AndroidManifest {
  version: string;
  /** android/app/build.gradle's version code for the version */
  versionCode: number;
  /** com.michael.teneo, or com.michael.teneo.beta for a beta */
  package: string;
  apk: { url: string; size: number; sha256: string };
}

const ANDROID_VERSION =
  /^(\d{1,4})\.(\d{1,2})\.(\d{1,2})(?:-beta\.([1-9]\d?))?$/;

/** The version code android/app/build.gradle gives a version, or null for
 *  a version release-android.yml wouldn't release. */
export function androidVersionCode(version: string): number | null {
  const match = ANDROID_VERSION.exec(version);
  if (!match || match[4] === "99") return null;
  return (
    Number(match[1]) * 1_000_000 +
    Number(match[2]) * 10_000 +
    Number(match[3]) * 100 +
    (match[4] === undefined ? 99 : Number(match[4]))
  );
}

/** Teneo Beta is an app of its own (android/app/build.gradle). */
export const androidPackage = (version: string) =>
  version.includes("-beta.") ? "com.michael.teneo.beta" : "com.michael.teneo";

export const androidApkName = (version: string) => `Teneo-${version}.apk`;

/** The APK's address in the release tagged `tag`: Teneo's own (v0.4.4), or,
 *  for a release of the Android app alone, android-v<version> */
export function androidApkUrl(
  repository: string,
  version: string,
  tag = `${ANDROID_TAG_PREFIX}${version}`,
): string {
  return `https://github.com/${repository}/releases/download/${tag}/${androidApkName(version)}`;
}

/** CI's plain manifest for the APK it built, which the maintainer signs. */
export function buildAndroidManifest(options: {
  version: string;
  repository: string;
  size: number;
  sha256: string;
  /** the release the APK is in, when it isn't android-v<version> */
  tag?: string;
}): AndroidManifest {
  const versionCode = androidVersionCode(options.version);
  if (versionCode === null)
    throw new Error(`${options.version} isn't an Android release version`);
  if (!/^[0-9a-f]{64}$/.test(options.sha256))
    throw new Error("the APK's sha256 must be 64 lowercase hex digits");
  if (!Number.isSafeInteger(options.size) || options.size <= 0)
    throw new Error("the APK's size must be a positive whole number");
  return {
    version: options.version,
    versionCode,
    package: androidPackage(options.version),
    apk: {
      url: androidApkUrl(options.repository, options.version, options.tag),
      size: options.size,
      sha256: options.sha256,
    },
  };
}

/** A clean copy, or null when any field is missing or mistyped. */
export function parseAndroidManifest(input: unknown): AndroidManifest | null {
  if (typeof input !== "object" || input === null) return null;
  const doc = input as Record<string, unknown>;
  if (Object.keys(doc).sort().join(",") !== "apk,package,version,versionCode")
    return null;
  const apk = doc.apk as Record<string, unknown> | null;
  if (
    typeof doc.version !== "string" ||
    typeof doc.versionCode !== "number" ||
    typeof doc.package !== "string" ||
    typeof apk !== "object" ||
    apk === null ||
    Object.keys(apk).sort().join(",") !== "sha256,size,url" ||
    typeof apk.url !== "string" ||
    typeof apk.size !== "number" ||
    !Number.isSafeInteger(apk.size) ||
    typeof apk.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(apk.sha256)
  )
    return null;
  return {
    version: doc.version,
    versionCode: doc.versionCode,
    package: doc.package,
    apk: { url: apk.url, size: apk.size, sha256: apk.sha256 },
  };
}

/** The signed manifest: the envelope alone, with no plain fields beside it
 *  for anything to read by mistake. */
export async function signAndroidManifest(
  manifest: AndroidManifest,
  privateKey: Parameters<typeof crypto.subtle.sign>[1],
): Promise<{ signed: unknown }> {
  return {
    signed: await signedEnvelope(
      ANDROID_FORMAT,
      JSON.stringify(manifest),
      privateKey,
    ),
  };
}

export async function verifyAndroidManifest(
  doc: unknown,
  publicKeys: string[],
): Promise<AndroidManifest> {
  const payload = parseAndroidManifest(
    JSON.parse(await verifiedPayload(doc, publicKeys, ANDROID_FORMAT)),
  );
  if (!payload) throw new Error("the signed Android manifest is malformed");
  return payload;
}

/** Every way a release and its Android manifest fail to describe each
 *  other: the manifest names this version's APK, and that is the file here.
 *  The release is the Android app's own (android-v<version>), which holds
 *  nothing else, or Teneo's, where the APK sits beside the Mac app. */
export function androidReleaseProblems(
  release: Release,
  manifest: AndroidManifest,
  repository: string,
  version: string,
): string[] {
  const problems: string[] = [];
  if (manifest.version !== version)
    problems.push(
      `the Android manifest says ${manifest.version}, not ${version}`,
    );
  if (manifest.versionCode !== androidVersionCode(version))
    problems.push(`the Android manifest's version code isn't ${version}'s`);
  if (manifest.package !== androidPackage(version))
    problems.push(
      `the Android manifest is for ${manifest.package}, not ${androidPackage(version)}`,
    );
  const name = androidApkName(version);
  const apk = release.assets.find((asset) => asset.name === name);
  if (
    manifest.apk.url !== androidApkUrl(repository, version, release.tag_name) ||
    !apk
  ) {
    problems.push(`the Android manifest's APK isn't ${name} of this release`);
  } else {
    if (digestOf(apk) !== manifest.apk.sha256)
      problems.push(
        `${name} isn't the file the Android manifest's hash describes`,
      );
    if (apk.size !== manifest.apk.size)
      problems.push(`${name} isn't the size the Android manifest says`);
  }
  const isAndroidOnly = release.tag_name.startsWith(ANDROID_TAG_PREFIX);
  for (const asset of isAndroidOnly ? release.assets : []) {
    if (asset.name !== name && asset.name !== ANDROID_MANIFEST)
      problems.push(`${asset.name} doesn't belong in an Android release`);
  }
  if (release.author?.login !== CI_LOGIN)
    problems.push(
      `the release was made by ${release.author?.login ?? "nobody"}, not CI`,
    );
  return problems;
}

/** Problems with an Android draft before it is signed. None means CI made all of it. */
export function checkAndroidDraft(
  release: Release,
  manifest: unknown,
  repository: string,
  version: string,
): string[] {
  const problems: string[] = [];
  if (!release.draft)
    problems.push(`${ANDROID_TAG_PREFIX}${version} is already published`);
  for (const asset of release.assets) {
    if (asset.uploader?.login !== CI_LOGIN)
      problems.push(
        `${asset.name} was uploaded by ${asset.uploader?.login ?? "nobody"}, not CI`,
      );
  }
  const plain = parseAndroidManifest(manifest);
  if (!plain)
    return [
      ...problems,
      `the draft's ${ANDROID_MANIFEST} isn't CI's plain manifest`,
    ];
  return [
    ...problems,
    ...androidReleaseProblems(release, plain, repository, version),
  ];
}

/** Why a published release must be pulled back to a draft, if it must. */
export async function checkPublishedRelease(options: {
  release: Release;
  /** manifest.json, or android-manifest.json for an Android release */
  manifest: unknown;
  publicKeys: string[];
  repository: string;
  /** every release, for the one the beta channel points at */
  releases?: Release[];
  /** Android manifests by name: a Teneo release's android-manifest.json, and
   *  the update channel's android-manifest.json and android-beta-manifest.json */
  files?: Record<string, unknown>;
}): Promise<string[]> {
  const { release, manifest, publicKeys, repository } = options;
  const after = (time: string | null) => time !== null && time > SIGNED_FROM;
  const afterAndroid = (time: string | null) =>
    time !== null && time > ANDROID_SIGNED_FROM;
  // the maintainer uploads the signed manifests; every other file is CI's
  const notFromCi = (asset: ReleaseAsset) =>
    asset.name !== "manifest.json" &&
    asset.name !== ANDROID_MANIFEST &&
    asset.uploader?.login !== CI_LOGIN;
  const verifiedAndroid = async (
    name: string,
  ): Promise<AndroidManifest | string> => {
    try {
      const doc = options.files?.[name];
      if (doc === undefined || doc === null)
        throw new Error(`${name} couldn't be read`);
      return await verifyAndroidManifest(doc, publicKeys);
    } catch (error) {
      return `${name}: ${(error as Error).message}`;
    }
  };
  const verified = async (): Promise<Manifest | string> => {
    try {
      if (manifest === null)
        throw new Error("the release has no manifest.json");
      return await verifyManifest(manifest, publicKeys);
    } catch (error) {
      return (error as Error).message;
    }
  };

  // The update channel: the newest Mac beta's manifest, and each Android
  // app's signed manifest, replaced on each release. Their signatures pin the
  // downloads, which live on the releases they name.
  if (release.tag_name === UPDATE_CHANNEL_TAG) {
    const problems: string[] = [];
    for (const name of [ANDROID_MANIFEST, ANDROID_BETA_MANIFEST]) {
      const asset = release.assets.find((candidate) => candidate.name === name);
      if (!asset || !afterAndroid(asset.updated_at)) continue;
      const payload = await verifiedAndroid(name);
      if (typeof payload === "string") {
        problems.push(payload);
        continue;
      }
      if (androidChannelFile(payload.version) !== name) {
        problems.push(
          `${name} offers ${payload.version}, which isn't its channel's`,
        );
        continue;
      }
      // the APK it names: a published release's, made by CI
      const tag = /\/releases\/download\/([^/]+)\//.exec(payload.apk.url)?.[1];
      const holder = options.releases?.find(
        (candidate) => candidate.tag_name === tag,
      );
      if (!holder || holder.draft) {
        problems.push(
          `${name} offers ${payload.version} from ${tag ?? "nowhere"}, which isn't released`,
        );
        continue;
      }
      problems.push(
        ...androidReleaseProblems(
          holder,
          payload,
          repository,
          payload.version,
        ).map((problem) => `${name}: ${problem}`),
      );
      const apk = holder.assets.find(
        (file) => file.name === androidApkName(payload.version),
      );
      if (apk && apk.uploader?.login !== CI_LOGIN)
        problems.push(`${name}: ${apk.name} wasn't uploaded by CI`);
    }
    const asset = release.assets.find(
      (candidate) => candidate.name === "manifest.json",
    );
    if (!asset || !after(asset.updated_at)) return problems;
    return [...problems, ...(await checkMacChannel())];
  }
  async function checkMacChannel(): Promise<string[]> {
    const payload = await verified();
    if (typeof payload === "string") return [payload];
    if (!payload.version.includes("-"))
      return [`the beta channel offers ${payload.version}, which isn't a beta`];
    // the beta it offers must be a release CI made, with the files it names
    const beta = options.releases?.find(
      (candidate) => candidate.tag_name === `v${payload.version}`,
    );
    if (!beta || beta.draft)
      return [
        `the beta channel offers ${payload.version}, which isn't released`,
      ];
    const problems = downloadProblems(
      beta,
      payload,
      repository,
      payload.version,
    );
    if (beta.author?.login !== CI_LOGIN)
      problems.push(
        `v${payload.version} was made by ${beta.author?.login ?? "nobody"}, not CI`,
      );
    for (const file of beta.assets.filter(notFromCi))
      problems.push(`v${payload.version}'s ${file.name} wasn't uploaded by CI`);
    return problems;
  }

  // Releases from before signing are left as they were, but a file added
  // or replaced since is checked like any new one.
  if (!after(release.published_at)) {
    return release.assets
      .filter(
        (asset) =>
          after(asset.updated_at) && asset.uploader?.login !== CI_LOGIN,
      )
      .map(
        (asset) =>
          `${asset.name} was added by ${asset.uploader?.login ?? "nobody"} after signing began`,
      );
  }

  if (release.tag_name.startsWith(ANDROID_TAG_PREFIX)) {
    const version = release.tag_name.slice(ANDROID_TAG_PREFIX.length);
    if (
      release.published_at !== null &&
      release.published_at > ANDROID_SIGNED_FROM
    ) {
      let payload: AndroidManifest;
      try {
        if (manifest === null)
          throw new Error(`the release has no ${ANDROID_MANIFEST}`);
        payload = await verifyAndroidManifest(manifest, publicKeys);
      } catch (error) {
        return [(error as Error).message];
      }
      const problems = androidReleaseProblems(
        release,
        payload,
        repository,
        version,
      );
      for (const asset of release.assets.filter(
        (file) =>
          file.name !== ANDROID_MANIFEST && file.uploader?.login !== CI_LOGIN,
      ))
        problems.push(`${asset.name} wasn't uploaded by CI`);
      return problems;
    }
    // From before Android releases were signed: CI must have made every file
    const problems = release.assets
      .filter(notFromCi)
      .map((asset) => `${asset.name} wasn't uploaded by CI`);
    if (release.author?.login !== CI_LOGIN)
      problems.push(
        `the release was made by ${release.author?.login ?? "nobody"}, not CI`,
      );
    return problems;
  }

  const payload = await verified();
  if (typeof payload === "string") return [payload];

  const version = release.tag_name.replace(/^v/, "");
  const problems = downloadProblems(release, payload, repository, version);
  if (release.author?.login !== CI_LOGIN)
    problems.push(
      `the release was made by ${release.author?.login ?? "nobody"}, not CI`,
    );
  for (const asset of release.assets.filter(notFromCi))
    problems.push(`${asset.name} wasn't uploaded by CI`);
  // Teneo's release holds the APK too, and the signed manifest that names it
  const android = release.assets.find(
    (asset) => asset.name === ANDROID_MANIFEST,
  );
  if (android && afterAndroid(release.published_at)) {
    const payload = await verifiedAndroid(ANDROID_MANIFEST);
    if (typeof payload === "string") problems.push(payload);
    else
      problems.push(
        ...androidReleaseProblems(
          release,
          payload,
          repository,
          payload.version,
        ),
      );
  }
  return problems;
}
