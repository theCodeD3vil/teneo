import { expect, test } from "bun:test";

import { findLink } from "./links";

test("a text that is one URL is a link, without www. in its host", () => {
  expect(findLink("  https://www.example.org/page?q=1 \n")).toEqual({
    url: "https://www.example.org/page?q=1",
    host: "example.org",
  });
});

test("it needs no URL.canParse, which an older Android web view lacks", () => {
  const canParse = URL.canParse;
  // @ts-expect-error -- taken away for the test
  delete URL.canParse;
  try {
    expect(findLink("https://example.org/a")?.host).toBe("example.org");
    expect(findLink("https://")).toBeNull();
  } finally {
    URL.canParse = canParse;
  }
});

test("text around a URL, another scheme or a bad URL is no link", () => {
  expect(findLink("see https://example.org")).toBeNull();
  expect(findLink("ftp://example.org")).toBeNull();
  expect(findLink("https://")).toBeNull();
  expect(findLink(`https://example.org/${"a".repeat(2048)}`)).toBeNull();
});
