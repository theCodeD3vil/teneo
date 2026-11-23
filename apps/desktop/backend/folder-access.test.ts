import { expect, mock, test } from "bun:test";

import { createFolderAccess } from "./folder-access";

test("enabled folders survive restarting without a fresh macOS probe", async () => {
  const probe = mock(async () => "granted" as const);
  let saved: unknown = [];
  const open = () =>
    createFolderAccess({
      home: () => "/test-home",
      probe,
      load: async () => saved,
      save: async (folders) => {
        saved = folders;
        return true;
      },
    });
  const first = open();
  expect(await first.status()).toEqual({});
  expect(await first.allows("/test-home/Desktop/example")).toBe(false);
  expect(probe).not.toHaveBeenCalled();

  await expect(first.change("Desktop", true)).resolves.toEqual({
    Desktop: "granted",
  });
  const reopened = open();
  expect(await reopened.status()).toEqual({ Desktop: "granted" });
  expect(await reopened.allows("/test-home/Desktop/example")).toBe(true);
  expect(await reopened.allows("/test-home/Documents/example")).toBe(false);
  expect(await reopened.allows("/test-home/DesktopOther/example")).toBe(false);
  expect(await reopened.allows("/test-home/Desktop/../Documents/example")).toBe(
    false,
  );
  await reopened.change("Desktop", true);
  expect(probe).toHaveBeenCalledTimes(1);

  await reopened.change("Desktop", false);
  expect(await open().status()).toEqual({});
  expect(probe).toHaveBeenCalledTimes(1);
});

test("denied requests and unrecognized saved folder names never authorize access", async () => {
  const probe = mock(async () => "denied" as const);
  const save = mock(async () => true);
  const access = createFolderAccess({
    home: () => "/test-home",
    probe,
    load: async () => ["../", "/etc"],
    save,
  });
  expect(await access.status()).toEqual({});
  await expect(access.change("../", true)).rejects.toThrow();
  expect(probe).not.toHaveBeenCalled();
  await expect(access.change("Downloads", true)).resolves.toEqual({
    Downloads: "denied",
  });
  expect(await access.allows("/test-home/Downloads/example")).toBe(false);
  expect(save).not.toHaveBeenCalled();
});

test("a store failure does not appear as a successful change", async () => {
  const probe = mock(async () => "granted" as const);
  const save = mock(async () => false);
  const access = createFolderAccess({
    home: () => "/test-home",
    probe,
    load: async () => ["Documents"],
    save,
  });
  await expect(access.change("Desktop", true)).rejects.toThrow();
  await expect(access.change("Documents", false)).rejects.toThrow();
  expect(await access.status()).toEqual({ Documents: "granted" });
});
