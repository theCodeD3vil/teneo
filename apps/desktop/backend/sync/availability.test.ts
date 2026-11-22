import { expect, test } from "bun:test";

import { isSyncAvailableIn, isTrustedSyncOfferedIn } from "./availability";

test("every build has sync, a full release as much as a beta", () => {
  expect(isSyncAvailableIn({})).toBe(true);
  expect(isSyncAvailableIn({ TENEO_SYNC: "1" })).toBe(true);
});

test("TENEO_SYNC=0 switches sync off for a run", () => {
  expect(isSyncAvailableIn({ TENEO_SYNC: "0" })).toBe(false);
});

test("betas offer Trusted Sync setup; stable builds only offer it when requested", () => {
  expect(isTrustedSyncOfferedIn({}, "0.4.4-beta.3")).toBe(true);
  expect(isTrustedSyncOfferedIn({}, "0.4.4")).toBe(false);
  expect(
    isTrustedSyncOfferedIn({ TENEO_TRUSTED_SYNC: "0" }, "0.4.4-beta.3"),
  ).toBe(false);
  expect(isTrustedSyncOfferedIn({ TENEO_TRUSTED_SYNC: "1" }, "0.4.4")).toBe(
    true,
  );
  expect(
    isTrustedSyncOfferedIn({ TINYJS_ICON: "icon-debug.png" }, "0.4.4-beta.3"),
  ).toBe(false);
});
