import { beforeAll, describe, expect, test } from "bun:test";

import {
  buildManifest,
  CI_LOGIN,
  checkDraft,
  checkPublishedRelease,
  type Manifest,
  publicKeysOf,
  type Release,
  type ReleaseAsset,
  signManifest,
  verifyManifest,
} from "./release-manifest.ts";

const repository = "theCodeD3vil/teneo";
const before = "2026-11-15T23:47:00Z";
const later = "2026-11-20T10:00:00Z";
const armHash = "a".repeat(64);
const intelHash = "b".repeat(64);

type KeyPair = {
  privateKey: Parameters<typeof crypto.subtle.sign>[1];
  publicKey: Parameters<typeof crypto.subtle.exportKey>[1];
};
const newKeyPair = async () =>
  (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as KeyPair;

let key: KeyPair;
let publicKey: string;
let otherKey: KeyPair;

beforeAll(async () => {
  key = await newKeyPair();
  otherKey = await newKeyPair();
  publicKey = Buffer.from(
    await crypto.subtle.exportKey("raw", key.publicKey),
  ).toString("base64");
});

function asset(
  name: string,
  overrides: Partial<ReleaseAsset> = {},
): ReleaseAsset {
  const digest = name.includes("arm64.zip")
    ? armHash
    : name.includes("x86_64.zip")
      ? intelHash
      : "c".repeat(64);
  return {
    id: 1,
    name,
    digest: `sha256:${digest}`,
    updated_at: later,
    uploader: { login: CI_LOGIN },
    ...overrides,
  };
}

function macRelease(
  version: string,
  overrides: Partial<Release> = {},
): Release {
  return {
    id: 7,
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes("-"),
    published_at: later,
    author: { login: CI_LOGIN },
    assets: [
      asset(`teneo-${version}-macos-arm64.zip`),
      asset(`teneo-${version}-macos-x86_64.zip`),
      asset(`teneo-${version}-macos-arm64.dmg`),
      asset("manifest.json", { uploader: { login: "theCodeD3vil" } }),
    ],
    ...overrides,
  };
}

function manifestFor(version: string): Manifest {
  return buildManifest({
    version,
    repository,
    notes: "Teneo " + version,
    builds: [
      {
        arch: "arm64",
        zip: `teneo-${version}-macos-arm64.zip`,
        sha256: armHash,
      },
      {
        arch: "x86_64",
        zip: `teneo-${version}-macos-x86_64.zip`,
        sha256: intelHash,
      },
    ],
  });
}

describe("verifyManifest", () => {
  test("accepts a manifest signed with a trusted key and returns its payload", async () => {
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    expect(await verifyManifest(signed, [publicKey])).toEqual(
      manifestFor("0.4.3"),
    );
  });

  test("trusts only the payload, not the plain fields beside it", async () => {
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    const edited = { ...signed, url: "https://evil.example/teneo.zip" };
    expect((await verifyManifest(edited, [publicKey])).url).toBe(
      manifestFor("0.4.3").url,
    );
  });

  test("rejects an unsigned manifest, like the one in the trojaned 0.4.2", async () => {
    expect(verifyManifest(manifestFor("0.4.2"), [publicKey])).rejects.toThrow(
      "isn't signed",
    );
  });

  test("rejects a payload changed after signing", async () => {
    const signed = (await signManifest(
      manifestFor("0.4.3"),
      key.privateKey,
    )) as Manifest & {
      signed: { payload: string };
    };
    signed.signed.payload = signed.signed.payload.replace(
      armHash,
      "f".repeat(64),
    );
    expect(verifyManifest(signed, [publicKey])).rejects.toThrow(
      "doesn't match",
    );
  });

  test("rejects a signature from another key, and accepts it once that key is trusted too", async () => {
    const signed = await signManifest(
      manifestFor("0.4.3"),
      otherKey.privateKey,
    );
    expect(verifyManifest(signed, [publicKey])).rejects.toThrow(
      "doesn't match",
    );
    const other = Buffer.from(
      await crypto.subtle.exportKey("raw", otherKey.publicKey),
    ).toString("base64");
    expect((await verifyManifest(signed, [publicKey, other])).version).toBe(
      "0.4.3",
    );
  });

  test("fails closed on a malformed key, an extra envelope field or no keys at all", async () => {
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    expect(verifyManifest(signed, [publicKey, "not-a-key"])).rejects.toThrow(
      "invalid update public key",
    );
    const extra = {
      ...signed,
      signed: { ...(signed.signed as object), keyId: "x" },
    };
    expect(verifyManifest(extra, [publicKey])).rejects.toThrow("isn't signed");
    expect(verifyManifest(signed, [])).rejects.toThrow("no update.publicKey");
  });
});

describe("publicKeysOf", () => {
  test("reads one key, a list, or none", () => {
    expect(publicKeysOf({ update: { publicKey: "abc" } })).toEqual(["abc"]);
    expect(publicKeysOf({ update: { publicKey: ["abc", "def"] } })).toEqual([
      "abc",
      "def",
    ]);
    expect(publicKeysOf({ update: {} })).toEqual([]);
    expect(publicKeysOf({})).toEqual([]);
  });
});

describe("buildManifest", () => {
  test("pins both builds to this release's tag, with arm64 at the top level", () => {
    const manifest = manifestFor("0.4.3");
    expect(manifest.mac?.x86_64?.url).toBe(
      "https://github.com/theCodeD3vil/teneo/releases/download/v0.4.3/teneo-0.4.3-macos-x86_64.zip",
    );
    expect(manifest.url).toBe(manifest.mac?.arm64?.url);
    expect(manifest.sha256).toBe(armHash);
  });

  test("refuses a manifest with one CPU missing", () => {
    expect(() =>
      buildManifest({
        version: "0.4.3",
        repository,
        builds: [{ arch: "arm64", zip: "a.zip", sha256: armHash }],
      }),
    ).toThrow("arm64 and an x86_64");
  });
});

describe("checkDraft", () => {
  const draft = (overrides: Partial<Release> = {}) =>
    macRelease("0.4.3", {
      draft: true,
      published_at: null,
      assets: macRelease("0.4.3").assets.map((a) => ({
        ...a,
        uploader: { login: CI_LOGIN },
      })),
      ...overrides,
    });

  test("passes a draft CI made, whose manifest points at its own zips", () => {
    expect(
      checkDraft(draft(), manifestFor("0.4.3"), repository, "0.4.3"),
    ).toEqual([]);
  });

  test("flags files or a draft that CI didn't make", () => {
    const tampered = draft();
    tampered.assets[0] = {
      ...tampered.assets[0],
      uploader: { login: "theCodeD3vil" },
    };
    expect(
      checkDraft(tampered, manifestFor("0.4.3"), repository, "0.4.3"),
    ).toContain(
      "teneo-0.4.3-macos-arm64.zip was uploaded by theCodeD3vil, not CI",
    );
    expect(
      checkDraft(
        draft({ author: { login: "theCodeD3vil" } }),
        manifestFor("0.4.3"),
        repository,
        "0.4.3",
      ),
    ).toContain("the draft was made by theCodeD3vil, not CI");
  });

  test("flags a manifest whose hash, address, version or fields aren't CI's", () => {
    const manifest = manifestFor("0.4.3");
    manifest.mac!.arm64!.sha256 = "e".repeat(64);
    manifest.mac!.x86_64!.url = "https://evil.example/teneo.zip";
    manifest.win = { url: "x" };
    const problems = checkDraft(draft(), manifest, repository, "0.4.3");
    expect(problems).toContain(
      "teneo-0.4.3-macos-arm64.zip isn't the file the manifest's hash describes",
    );
    expect(problems).toContain(
      "the x86_64 download isn't a file of this release: https://evil.example/teneo.zip",
    );
    expect(problems).toContain('the manifest has an unexpected field "win"');
    expect(
      checkDraft(draft(), manifestFor("0.4.4"), repository, "0.4.3"),
    ).toContain("the manifest says 0.4.4, not 0.4.3");
  });

  test("refuses a draft that is published or already signed", async () => {
    expect(
      checkDraft(
        macRelease("0.4.3"),
        manifestFor("0.4.3"),
        repository,
        "0.4.3",
      ),
    ).toContain("v0.4.3 is already published");
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    expect(checkDraft(draft(), signed, repository, "0.4.3")).toContain(
      "the draft's manifest is already signed",
    );
  });
});

describe("checkPublishedRelease", () => {
  const check = async (release: Release, manifest: unknown) =>
    checkPublishedRelease({
      release,
      manifest,
      publicKeys: [publicKey],
      repository,
    });

  test("passes a signed release of CI's files, its manifest uploaded by the maintainer", async () => {
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    expect(await check(macRelease("0.4.3"), signed)).toEqual([]);
  });

  test("pulls a release like the trojaned 0.4.2: made by the account, unsigned", async () => {
    const attack = macRelease("0.4.2", {
      author: { login: "theCodeD3vil" },
      assets: macRelease("0.4.2").assets.map((a) => ({
        ...a,
        uploader: { login: "theCodeD3vil" },
      })),
    });
    expect(await check(attack, manifestFor("0.4.2"))).toEqual([
      "the manifest isn't signed",
    ]);
    expect(await check(attack, null)).toEqual([
      "the release has no manifest.json",
    ]);
  });

  test("pulls a signed release with a file CI didn't upload beside it", async () => {
    const release = macRelease("0.4.3");
    release.assets.push(
      asset("Teneo-0.4.3-installer.pkg", { uploader: { login: "someone" } }),
    );
    const signed = await signManifest(manifestFor("0.4.3"), key.privateKey);
    expect(await check(release, signed)).toEqual([
      "Teneo-0.4.3-installer.pkg wasn't uploaded by CI",
    ]);
  });

  test("leaves releases from before signing alone, unless a file changed since", async () => {
    const legacy = macRelease("0.4.1", { published_at: before });
    legacy.assets = legacy.assets.map((a) => ({ ...a, updated_at: before }));
    expect(await check(legacy, manifestFor("0.4.1"))).toEqual([]);
    legacy.assets[0] = {
      ...legacy.assets[0],
      updated_at: later,
      uploader: { login: "theCodeD3vil" },
    };
    expect(await check(legacy, manifestFor("0.4.1"))).toEqual([
      "teneo-0.4.1-macos-arm64.zip was added by theCodeD3vil after signing began",
    ]);
  });

  test("requires Android releases to hold only CI's files", async () => {
    const android: Release = {
      ...macRelease("0.1.3"),
      tag_name: "android-v0.1.3",
      assets: [asset("Teneo-0.1.3.apk")],
    };
    expect(await check(android, null)).toEqual([]);
    android.assets[0] = {
      ...android.assets[0],
      uploader: { login: "theCodeD3vil" },
    };
    expect(await check(android, null)).toEqual([
      "Teneo-0.1.3.apk wasn't uploaded by CI",
    ]);
  });

  test("checks the beta channel's manifest once it changes after signing began", async () => {
    const channel = (updated: string): Release => ({
      ...macRelease("0.4.3-beta.1"),
      tag_name: "beta-channel",
      published_at: before,
      assets: [
        asset("manifest.json", {
          updated_at: updated,
          uploader: { login: "theCodeD3vil" },
        }),
      ],
    });
    expect(await check(channel(before), manifestFor("0.4.2-beta.1"))).toEqual(
      [],
    );
    expect(
      await check(
        channel(later),
        await signManifest(manifestFor("0.4.3-beta.1"), key.privateKey),
      ),
    ).toEqual([]);
    expect(await check(channel(later), manifestFor("0.4.3-beta.1"))).toEqual([
      "the manifest isn't signed",
    ]);
    expect(
      await check(
        channel(later),
        await signManifest(manifestFor("0.4.3"), key.privateKey),
      ),
    ).toEqual(["the beta channel offers 0.4.3, which isn't a beta"]);
  });
});
