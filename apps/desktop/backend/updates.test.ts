import { expect, test } from "bun:test";

import { isUpdateArchive } from "./updates";

const response = (
  status: number,
  headers: Record<string, string>,
  body = true,
) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    body: body ? {} : null,
    headers: new Headers(headers),
  }) as unknown as Response;

test("the empty redirect at the .zip URL is not the download", () => {
  const redirect = response(302, {
    location: "https://blob/x?sig=1",
    "content-length": "0",
  });
  expect(
    isUpdateArchive(
      "https://github.com/o/r/releases/download/v1/teneo-1.zip",
      redirect,
    ),
  ).toBe(false);
});

test("the blob that carries the bytes is told by its content-disposition", () => {
  const blob = response(200, {
    "content-disposition": "attachment; filename=teneo-1.zip",
  });
  expect(
    isUpdateArchive(
      "https://release-assets.githubusercontent.com/a/uuid?sp=r",
      blob,
    ),
  ).toBe(true);
  const encoded = response(200, {
    "content-disposition": "attachment; filename*=UTF-8''teneo%2D1.zip",
  });
  expect(isUpdateArchive("https://x/y", encoded)).toBe(true);
});

test("the manifest and bodiless answers are not the download", () => {
  const manifest = response(200, {
    "content-disposition": "attachment; filename=manifest.json",
  });
  expect(
    isUpdateArchive(
      "https://release-assets.githubusercontent.com/a/uuid2?sp=r",
      manifest,
    ),
  ).toBe(false);
  expect(
    isUpdateArchive(
      "https://example.com/dl/teneo-1.zip",
      response(200, {}, false),
    ),
  ).toBe(false);
});

test("a plain archive URL counts by its path", () => {
  expect(
    isUpdateArchive("https://example.com/dl/teneo-1.zip", response(200, {})),
  ).toBe(true);
  expect(
    isUpdateArchive("https://example.com/dl/teneo-1.tar.gz", response(200, {})),
  ).toBe(true);
});
