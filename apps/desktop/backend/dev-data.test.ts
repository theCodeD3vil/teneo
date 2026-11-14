import { expect, test } from "bun:test";

import { devFolder, isDevRunEnv, isRealDataInDevRunEnv } from "./dev-data";
import { devName, isDevRun } from "./dev-run";

test("only `tinyjs dev` (which sets TINYJS_ICON) is a dev run", () => {
  expect(isDevRunEnv({})).toBe(false);
  expect(isDevRunEnv({ TINYJS_ICON: "/app/icon.png" })).toBe(true);
});

test("TENEO_REAL_DATA=1 turns a dev run back to the real data, and only then", () => {
  const icon = { TINYJS_ICON: "/app/icon.png" };
  expect(isDevRunEnv({ ...icon, TENEO_REAL_DATA: "1" })).toBe(false);
  expect(isRealDataInDevRunEnv({ ...icon, TENEO_REAL_DATA: "1" })).toBe(true);
  expect(isDevRunEnv({ ...icon, TENEO_REAL_DATA: "0" })).toBe(true);
  expect(isRealDataInDevRunEnv({ ...icon, TENEO_REAL_DATA: "0" })).toBe(false);
  // a packaged build has no icon variable, so the switch changes nothing there
  expect(isRealDataInDevRunEnv({ TENEO_REAL_DATA: "1" })).toBe(false);
});

test("the dev folder sits inside the app folder, with or without a trailing slash", () => {
  expect(devFolder("/Users/me/Library/Application Support/id")).toBe(
    "/Users/me/Library/Application Support/id/dev",
  );
  expect(devFolder("/Users/me/Library/Caches/id/")).toBe(
    "/Users/me/Library/Caches/id/dev",
  );
});

test("without tjs (bun test) nothing is a dev run and names stay as they are", () => {
  expect(isDevRun()).toBe(false);
  expect(devName("settings")).toBe("settings");
});
