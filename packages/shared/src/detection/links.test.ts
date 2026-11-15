import { expect, test } from "bun:test";

import { findLink } from "./links";

test("a text that is one URL is a link, without www. in its host", () => {
  expect(findLink("  https://www.example.org/page?q=1 \n")).toEqual({
    url: "https://www.example.org/page?q=1",
    host: "example.org",
  });
});

test("text around a URL, another scheme or a bad URL is no link", () => {
  expect(findLink("see https://example.org")).toBeNull();
  expect(findLink("ftp://example.org")).toBeNull();
  expect(findLink("https://")).toBeNull();
  expect(findLink(`https://example.org/${"a".repeat(2048)}`)).toBeNull();
});
