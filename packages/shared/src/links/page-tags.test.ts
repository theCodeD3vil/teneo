import { expect, test } from "bun:test";

import { findIcons, findPageImageUrl } from "./page-tags";

test("icons come best first: the touch icon, the largest, then an svg", () => {
  const html = `<html><head>
    <link rel="icon" type="image/svg+xml" href="/icon.svg">
    <link rel="icon" sizes="32x32" href="/small.png">
    <link rel="shortcut icon" sizes="96x96" href="large.png">
    <link rel="apple-touch-icon" href="https://cdn.example.com/touch.png?a=1&amp;b=2">
    <link rel="stylesheet" href="/style.css">
  </head><body><link rel="icon" href="/in-body.png"></body></html>`;
  expect(findIcons(html, "https://example.com/docs/page")).toEqual([
    { url: "https://cdn.example.com/touch.png?a=1&b=2", isSvg: false },
    { url: "https://example.com/docs/large.png", isSvg: false },
    { url: "https://example.com/small.png", isSvg: false },
    { url: "https://example.com/icon.svg", isSvg: true },
  ]);
});

test("the page's share image is its og:image or twitter:image", () => {
  const page = "https://example.com/post";
  expect(
    findPageImageUrl(
      `<meta name="twitter:image" content="/twitter.png"><meta property="og:image" content="/og.png">`,
      page,
    ),
  ).toBe("https://example.com/twitter.png");
  expect(findPageImageUrl(`<meta property="og:title" content="x">`, page)).toBe(
    null,
  );
  // only a web address is fetched
  expect(
    findPageImageUrl(
      `<meta property="og:image" content="data:image/png;base64,AAAA">`,
      page,
    ),
  ).toBe(null);
});
