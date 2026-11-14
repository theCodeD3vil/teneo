import { expect, test } from "bun:test";

import {
  afterCursor,
  likePattern,
  listOrder,
  matchesSearch,
  pageOrder,
  truncateTextPreview,
  unpinnedOrder,
} from "./history-query";

test("a short text is passed through whole", () => {
  expect(truncateTextPreview("hello", [])).toEqual({
    text: "hello",
    secrets: [],
    isTruncated: false,
  });
});

test("a long text is cut and the secrets after the cut dropped", () => {
  const text = "a".repeat(1500);
  const secrets = [
    { start: 10, end: 20, label: "key" },
    { start: 1200, end: 1210, label: "key" },
  ];
  const preview = truncateTextPreview(text, secrets);
  expect(preview.text.length).toBe(1000);
  expect(preview.secrets).toEqual([secrets[0]]);
  expect(preview.isTruncated).toBe(true);
});

test("the cut moves before a secret it would split", () => {
  const text = "x".repeat(1500);
  const secrets = [{ start: 990, end: 1030, label: "token" }];
  const preview = truncateTextPreview(text, secrets);
  expect(preview.text.length).toBe(990);
  expect(preview.secrets).toEqual([]);
});

test("a text sqlite already shortened is marked as truncated", () => {
  const preview = truncateTextPreview("abc", [], 5000);
  expect(preview.isTruncated).toBe(true);
  expect(preview.text).toBe("abc");
});

test("like patterns escape sqlite wildcards", () => {
  expect(likePattern("50%_A\\")).toBe("%50\\%\\_a\\\\%");
});

test("the cursor after a pinned item keeps unpinned items", () => {
  const { condition, values } = afterCursor({
    pinnedAt: 5,
    dateCopied: 3,
    id: "b",
  });
  expect(condition).toBe(
    "(pinnedAt IS NULL OR (pinnedAt, dateCopied, id) < (?, ?, ?))",
  );
  expect(values).toEqual([5, 3, "b"]);
});

test("the cursor after an unpinned item skips the pinned ones", () => {
  const { condition, values } = afterCursor({
    pinnedAt: null,
    dateCopied: 3,
    id: "b",
  });
  expect(condition).toBe("(pinnedAt IS NULL AND (dateCopied, id) < (?, ?))");
  expect(values).toEqual([3, "b"]);
});

test("a page past the pinned items drops the constant order terms", () => {
  expect(pageOrder(undefined)).toBe(listOrder);
  expect(pageOrder({ pinnedAt: 5, dateCopied: 3, id: "b" })).toBe(listOrder);
  expect(pageOrder({ pinnedAt: null, dateCopied: 3, id: "b" })).toBe(
    unpinnedOrder,
  );
  expect(listOrder.endsWith(unpinnedOrder)).toBe(true);
});

const keyText = "token=ghp_abcdefghijklmnopqrstuvwxyz1234 for ci";
const keyItem = {
  text: keyText,
  secrets: [{ start: 6, end: 40, label: "GitHub token" }],
  color: null,
  paths: [],
  sourceAppName: "Terminal",
};

test("a masked key is found by its kind and tail, not its body", () => {
  expect(matchesSearch(keyItem, "github token", true)).toBe(true);
  expect(matchesSearch(keyItem, "1234", true)).toBe(true);
  expect(matchesSearch(keyItem, "klmnop", true)).toBe(false);
  expect(matchesSearch(keyItem, "for ci", true)).toBe(true);
});

test("with masking off the key itself is searchable", () => {
  expect(matchesSearch(keyItem, "klmnop", false)).toBe(true);
});

test("paths, colors and the source app are searched", () => {
  const item = {
    text: null,
    secrets: [],
    color: "#FF0000",
    paths: ["/Users/me/Report.pdf"],
    sourceAppName: "Finder",
  };
  expect(matchesSearch(item, "report", false)).toBe(true);
  expect(matchesSearch(item, "#ff00", false)).toBe(true);
  expect(matchesSearch(item, "finder", false)).toBe(true);
  expect(matchesSearch(item, "safari", false)).toBe(false);
});
