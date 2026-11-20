import { describe, expect, test } from "bun:test";

import { UpdateCheckError, findUpdate } from "./releases";

const sha256 = "ab".repeat(32);
const apk = (tag: string, version: string) =>
  `https://github.com/theCodeD3vil/teneo/releases/download/${tag}/Teneo-${version}.apk`;

/** UpdatePlugin.check, answering what the channel's signed manifest says */
function source(update: unknown) {
  let asked = 0;
  return {
    check: async () => {
      asked += 1;
      return { update };
    },
    asked: () => asked,
  };
}

describe("findUpdate", () => {
  test("offers what the signed manifest names", async () => {
    const update = {
      version: "0.1.3-beta.1",
      versionCode: 10301,
      apkUrl: apk("v0.4.4-beta.1", "0.1.3-beta.1"),
      size: 9_000_000,
      sha256,
    };
    const found = source(update);
    expect(await findUpdate("0.1.2-beta.1", found)).toEqual(update);
    expect(found.asked()).toBe(1);
  });

  test("an APK in the Android app's own release is fine too", async () => {
    const update = {
      version: "0.2.0",
      versionCode: 20099,
      apkUrl: apk("android-v0.2.0", "0.2.0"),
      size: 9_000_000,
      sha256,
    };
    expect(await findUpdate("0.1.0", source(update))).toEqual(update);
  });

  test("nothing newer is no update", async () => {
    expect(await findUpdate("0.1.0", source(null))).toBeNull();
  });

  test("a beta is never offered to Teneo, nor a full release to Teneo Beta", async () => {
    const beta = {
      version: "0.2.0-beta.1",
      versionCode: 20001,
      apkUrl: apk("v0.5.0-beta.1", "0.2.0-beta.1"),
      size: 1,
      sha256,
    };
    expect(await findUpdate("0.1.0", source(beta))).toBeNull();
    const full = { ...beta, version: "0.2.0", versionCode: 20099 };
    expect(await findUpdate("0.1.0-beta.1", source(full))).toBeNull();
  });

  test("an older or equal version, or one whose code doesn't match it, is no update", async () => {
    const base = { apkUrl: apk("v0.4.4", "0.1.0"), size: 1, sha256 };
    expect(
      await findUpdate(
        "0.1.1",
        source({ ...base, version: "0.1.0", versionCode: 10099 }),
      ),
    ).toBeNull();
    expect(
      await findUpdate(
        "0.1.0",
        source({ ...base, version: "0.1.0", versionCode: 10099 }),
      ),
    ).toBeNull();
    expect(
      await findUpdate(
        "0.1.0",
        source({ ...base, version: "0.2.0", versionCode: 99_999_999 }),
      ),
    ).toBeNull();
  });

  test("a malformed answer, or one naming a file elsewhere, is no update", async () => {
    const good = {
      version: "0.2.0",
      versionCode: 20099,
      apkUrl: apk("v0.5.0", "0.2.0"),
      size: 1,
      sha256,
    };
    for (const bad of [
      { ...good, apkUrl: "https://evil.example/Teneo-0.2.0.apk" },
      { ...good, sha256: "nope" },
      { ...good, size: 0 },
      { ...good, version: "latest" },
      "0.2.0",
    ]) {
      expect(await findUpdate("0.1.0", source(bad))).toBeNull();
    }
  });

  test("a failed check says why", async () => {
    const failing = {
      check: async () => {
        throw new Error("This update isn't signed by Teneo");
      },
    };
    const error = await findUpdate("0.1.0", failing).catch((caught) => caught);
    expect(error).toBeInstanceOf(UpdateCheckError);
    expect(error.message).toBe("This update isn't signed by Teneo");
  });

  test("a build with no release version can't compare", async () => {
    await expect(findUpdate("dev", source(null))).rejects.toThrow(
      "no release version",
    );
  });
});
