import { expect, test } from "bun:test";

import { isSyncAvailableIn } from "./availability";

test("every build has sync, a full release as much as a beta", () => {
  expect(isSyncAvailableIn({})).toBe(true);
  expect(isSyncAvailableIn({ TENEO_SYNC: "1" })).toBe(true);
});

test("TENEO_SYNC=0 switches sync off for a run", () => {
  expect(isSyncAvailableIn({ TENEO_SYNC: "0" })).toBe(false);
});
