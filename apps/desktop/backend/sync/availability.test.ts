import { expect, test } from "bun:test";

import { isBetaVersion, isSyncAvailableIn } from "./availability";

test("a full release has no sync unless TENEO_SYNC=1 asks for it", () => {
  expect(isSyncAvailableIn({}, "0.4.0")).toBe(false);
  expect(isSyncAvailableIn({ TENEO_SYNC: "0" }, "0.4.0")).toBe(false);
  expect(isSyncAvailableIn({ TENEO_SYNC: "1" }, "0.4.0")).toBe(true);
});

test("a beta build has sync without being asked", () => {
  expect(isSyncAvailableIn({}, "0.4.0-beta.1")).toBe(true);
  expect(isSyncAvailableIn({}, "0.4.0-beta")).toBe(true);
});

test("only a beta suffix makes a beta", () => {
  expect(isBetaVersion("0.4.0-beta.12")).toBe(true);
  expect(isBetaVersion("0.4.0")).toBe(false);
  expect(isBetaVersion("0.4.0-rc.1")).toBe(false);
  expect(isBetaVersion("0.4.0-betamax")).toBe(false);
  expect(isBetaVersion("beta")).toBe(false);
});
