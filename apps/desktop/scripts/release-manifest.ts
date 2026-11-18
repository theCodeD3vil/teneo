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
];
export const updateKeyReference = (vault: string) =>
  `op://${vault}/${UPDATE_KEY_TITLE}/password`;

/** Mac releases published from here on must be signed (the watchdog's line). */
export const SIGNED_FROM = "2026-11-18T00:00:00Z";

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

/** The signed payload, once its signature checks out against one of the keys. */
export async function verifyManifest(
  doc: unknown,
  publicKeys: string[],
): Promise<Manifest> {
  if (publicKeys.length === 0)
    throw new Error("tinyjs.json has no update.publicKey");
  const envelope = (doc as { signed?: Record<string, unknown> } | null)?.signed;
  if (
    !envelope ||
    typeof envelope !== "object" ||
    envelope.format !== "tinyjs-update-v1" ||
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
  const message = new TextEncoder().encode(SIGNATURE_PREFIX + envelope.payload);
  for (const raw of keys) {
    const key = await crypto.subtle.importKey("raw", raw, "Ed25519", false, [
      "verify",
    ]);
    if (await crypto.subtle.verify("Ed25519", key, signature, message)) {
      const payload = JSON.parse(envelope.payload) as Manifest;
      if (typeof payload?.version !== "string")
        throw new Error("the signed manifest has no version");
      return payload;
    }
  }
  throw new Error("the manifest's signature doesn't match Teneo's update key");
}

/** Sign as TinyJS does. Tests use it; releases are signed by `tinyjs publish --sign-manifest`. */
export async function signManifest(
  manifest: Manifest,
  privateKey: Parameters<typeof crypto.subtle.sign>[1],
): Promise<Manifest> {
  const { signed: _old, ...plain } = manifest;
  const payload = JSON.stringify(plain);
  const message = new TextEncoder().encode(SIGNATURE_PREFIX + payload);
  const signature = Buffer.from(
    await crypto.subtle.sign("Ed25519", privateKey, message),
  ).toString("base64");
  return {
    ...plain,
    signed: {
      format: "tinyjs-update-v1",
      algorithm: "Ed25519",
      payload,
      signature,
    },
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

/** Why a published release must be pulled back to a draft, if it must. */
export async function checkPublishedRelease(options: {
  release: Release;
  manifest: unknown;
  publicKeys: string[];
  repository: string;
}): Promise<string[]> {
  const { release, manifest, publicKeys, repository } = options;
  const after = (time: string | null) => time !== null && time > SIGNED_FROM;
  const notFromCi = (asset: ReleaseAsset) =>
    asset.name !== "manifest.json" && asset.uploader?.login !== CI_LOGIN;
  const verified = async (): Promise<Manifest | string> => {
    try {
      if (manifest === null)
        throw new Error("the release has no manifest.json");
      return await verifyManifest(manifest, publicKeys);
    } catch (error) {
      return (error as Error).message;
    }
  };

  // The beta channel holds only the newest beta's manifest, replaced on each
  // beta. Its signature pins the downloads, which live on that beta's release.
  if (release.tag_name === "beta-channel") {
    const asset = release.assets.find(
      (candidate) => candidate.name === "manifest.json",
    );
    if (!asset || !after(asset.updated_at)) return [];
    const payload = await verified();
    if (typeof payload === "string") return [payload];
    return payload.version.includes("-")
      ? []
      : [`the beta channel offers ${payload.version}, which isn't a beta`];
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

  // Android releases have no manifest yet: CI must have made every file.
  if (release.tag_name.startsWith("android-v")) {
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
  return problems;
}
