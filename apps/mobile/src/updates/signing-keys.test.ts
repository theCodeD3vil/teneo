// One key signs Teneo's updates, Mac and Android. The Android app carries its
// public half in SignedManifest.java, the Mac app in tinyjs.json: rotating it
// means changing both, and this fails until they agree.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  publicKeysOf,
  verifyAndroidManifest,
} from "../../../desktop/scripts/release-manifest.ts";

const mobile = join(import.meta.dir, "../..");
const javaKeys = (): string[] => {
  const source = readFileSync(
    join(
      mobile,
      "android/app/src/github/java/com/michael/teneo/updates/SignedManifest.java",
    ),
    "utf8",
  );
  const list = /PUBLIC_KEYS = \{([^}]*)\}/.exec(source)?.[1] ?? "";
  return [...list.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
};

describe("the update signing key", () => {
  test("is the same in the Android app as in the Mac app", () => {
    const tinyjs = JSON.parse(
      readFileSync(join(mobile, "../desktop/tinyjs.json"), "utf8"),
    );
    expect(javaKeys()).toEqual(publicKeysOf(tinyjs));
    expect(javaKeys().length).toBeGreaterThan(0);
  });

  test("signs manifests the phone reads: the fixture SignedManifestTest checks", async () => {
    const fixture = JSON.parse(
      readFileSync(
        join(
          mobile,
          "android/app/src/testGithub/resources/signed-android-manifest.json",
        ),
        "utf8",
      ),
    );
    const manifest = await verifyAndroidManifest(fixture.manifest, [
      fixture.publicKey,
    ]);
    expect(manifest.version).toBe("0.1.4");
    // and Teneo's own key doesn't accept the test key's signature
    await expect(
      verifyAndroidManifest(fixture.manifest, javaKeys()),
    ).rejects.toThrow();
  });
});
