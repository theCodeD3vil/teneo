import { expect, test } from "bun:test";

import { isRepeatCopy } from "./duplicate-copy";

const clipboard = {
  changeCount: 1,
  text: null,
  html: null,
  paths: [],
  image: null,
  imageSize: null,
  color: null,
  concealed: false,
  sourceApp: null,
  sourceURL: null,
} satisfies Omit<TinyClipboardData, "kind">;

test("the same text copied again is a repeat", () => {
  const latest = { id: "a", kind: "text", value: "hello", path: null } as const;
  expect(
    isRepeatCopy({ ...clipboard, kind: "text", text: "hello" }, latest),
  ).toBe(true);
  expect(
    isRepeatCopy({ ...clipboard, kind: "text", text: "hello " }, latest),
  ).toBe(false);
  expect(isRepeatCopy({ ...clipboard, kind: "text", text: null }, latest)).toBe(
    false,
  );
});

test("a different kind is never a repeat, even with the same value", () => {
  const latest = {
    id: "a",
    kind: "text",
    value: "#ff0000",
    path: null,
  } as const;
  expect(
    isRepeatCopy({ ...clipboard, kind: "color", color: "#ff0000" }, latest),
  ).toBe(false);
});

test("the same files in the same order are a repeat", () => {
  const paths = ["/Users/me/a.pdf", "/Users/me/b.pdf"];
  const latest = {
    id: "a",
    kind: "files",
    value: null,
    path: JSON.stringify(paths),
  } as const;
  expect(isRepeatCopy({ ...clipboard, kind: "files", paths }, latest)).toBe(
    true,
  );
  expect(
    isRepeatCopy(
      { ...clipboard, kind: "files", paths: [...paths].reverse() },
      latest,
    ),
  ).toBe(false);
});

test("an image is never a repeat", () => {
  const latest = {
    id: "a",
    kind: "image",
    value: null,
    path: "x.png",
  } as const;
  expect(
    isRepeatCopy({ ...clipboard, kind: "image", image: "/tmp/x.png" }, latest),
  ).toBe(false);
});
