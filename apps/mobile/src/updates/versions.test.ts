import { describe, expect, test } from "bun:test";

import { parseVersion, versionCode } from "./versions";

describe("versions", () => {
  test("reads the versions the release workflow allows", () => {
    expect(parseVersion("1.2.3")).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      beta: null,
    });
    expect(parseVersion("0.1.0-beta.1")).toEqual({
      major: 0,
      minor: 1,
      patch: 0,
      beta: 1,
    });
    for (const text of [
      "",
      "dev",
      "1.2",
      "v1.2.3",
      "1.100.0",
      "1.2.3-beta.0",
      "1.2.3-beta.99",
      "1.2.3-rc.1",
      "1.2.3 ",
    ]) {
      expect(parseVersion(text)).toBeNull();
    }
  });

  test("makes the version codes build.gradle makes", () => {
    const code = (text: string) => versionCode(parseVersion(text)!);
    expect(code("1.2.3-beta.4")).toBe(1_020_304);
    expect(code("1.2.3")).toBe(1_020_399);
    expect(code("0.1.0-beta.1")).toBe(10_001);
    // a full release is newer than its betas, older than the next version's
    expect(code("1.2.3")).toBeGreaterThan(code("1.2.3-beta.98"));
    expect(code("1.2.4-beta.1")).toBeGreaterThan(code("1.2.3"));
  });
});
