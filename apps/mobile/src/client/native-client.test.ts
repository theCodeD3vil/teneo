import { describe, expect, test } from "bun:test";

import { defaultSettings, type MobileSettings } from "../types/settings";
import type { HistoryPlugin, NativeItem } from "./history-plugin";
import { NativeClient, toHistoryItem } from "./native-client";

const nativeItem: NativeItem = {
  id: "item-1",
  dateCopied: 1000,
  text: "https://example.org",
  sourceAppName: "Pixel 6 Pro",
  sourceAppBundleId: null,
  pinned: true,
  secrets: [],
  linkUrl: "https://example.org",
  linkHost: "example.org",
  isTruncated: false,
  detectorVersion: 1,
};

/** A plugin with only what a test needs; the rest throws */
function fakePlugin(overrides: Partial<HistoryPlugin> = {}) {
  let emit: (event: { database: string }) => void = () => {};
  const plugin = new Proxy(
    {
      addListener: async (
        _event: string,
        listener: (event: { database: string }) => void,
      ) => {
        emit = listener;
        return { remove: async () => {} };
      },
      ...overrides,
    } as HistoryPlugin,
    {
      get(target, name: keyof HistoryPlugin) {
        if (name in target) return target[name];
        return () => Promise.reject(new Error(`${String(name)} isn't faked`));
      },
    },
  );
  return { plugin, emit: (event: { database: string }) => emit(event) };
}

describe("NativeClient", () => {
  test("shows a native item as a text item", () => {
    expect(toHistoryItem(nativeItem)).toEqual({
      id: "item-1",
      dateCopied: 1000,
      kind: "text",
      changeCount: 1000,
      text: "https://example.org",
      html: null,
      paths: [],
      image: null,
      imageSize: null,
      color: null,
      concealed: false,
      sourceApp: { name: "Pixel 6 Pro", bundleId: null },
      sourceURL: null,
      pinned: true,
      pasteAsFile: false,
      fileSize: null,
      secrets: [],
      link: { url: "https://example.org", host: "example.org" },
      isTruncated: false,
    });
    const bare = toHistoryItem({
      ...nativeItem,
      sourceAppName: null,
      linkHost: null,
    });
    expect([bare.sourceApp, bare.link]).toEqual([null, null]);
  });

  test("passes the request and its database through, and maps the page", async () => {
    let asked: unknown;
    const { plugin } = fakePlugin({
      list: async (options) => {
        asked = options;
        return {
          items: [nativeItem],
          nextCursor: { pinnedAt: 5, dateCopied: 1000, id: "item-1" },
          total: 3,
        };
      },
    });
    const client = new NativeClient(plugin, { database: "contract-a.sqlite" });
    const cursor = { pinnedAt: null, dateCopied: 9, id: "x" };
    const page = await client.listItems({
      kind: "all",
      search: "ex",
      cursor,
      limit: 1,
    });
    expect(asked).toEqual({
      database: "contract-a.sqlite",
      kind: "all",
      search: "ex",
      cursor,
      limit: 1,
    });
    expect(page.items[0]?.link?.host).toBe("example.org");
    expect([page.nextCursor?.pinnedAt, page.total]).toEqual([5, 3]);
  });

  test("the first start saves the default settings", async () => {
    let stored: Partial<MobileSettings> = { maxItems: 100 };
    const saved: Partial<MobileSettings>[] = [];
    const { plugin } = fakePlugin({
      getSettings: async () => ({ settings: { ...stored } }),
      updateSettings: async ({ changes }) => {
        saved.push(changes);
        stored = { ...stored, ...changes };
        return { settings: { ...stored } };
      },
    });
    const client = new NativeClient(plugin);
    const expected = { ...defaultSettings, maxItems: 100 };
    expect(await client.getSettings()).toEqual(expected);
    const { maxItems: _kept, ...unsaved } = defaultSettings;
    expect(saved).toEqual([unsaved]);

    // once saved, reading them saves nothing
    expect(await client.getSettings()).toEqual(expected);
    expect(saved.length).toBe(1);
  });

  test("hears changes to its own database only", async () => {
    const { plugin, emit } = fakePlugin();
    const client = new NativeClient(plugin);
    await Promise.resolve();
    let heard = 0;
    const stop = client.onHistoryChanged(() => heard++);
    emit({ database: "teneo.sqlite" });
    emit({ database: "contract-a.sqlite" });
    expect(heard).toBe(1);
    stop();
    emit({ database: "teneo.sqlite" });
    expect(heard).toBe(1);
  });

  test("a copy that native code couldn't make rejects", async () => {
    const { plugin } = fakePlugin({
      copy: () => Promise.reject(new Error("This item has no text to copy")),
    });
    const client = new NativeClient(plugin);
    await expect(client.copyToClipboard("gone")).rejects.toThrow(
      "This item has no text to copy",
    );
  });

  test("looks for secrets and links in new texts before listing, then not until a change", async () => {
    const calls: string[] = [];
    const saved: unknown[] = [];
    let waiting = [
      { id: "link", text: " https://www.example.org/x " },
      { id: "secret", text: "postgres://user:pa55@db.example.com/app" },
    ];
    const { plugin, emit } = fakePlugin({
      undetected: async (options) => {
        calls.push(`undetected v${options.detectorVersion}`);
        return { items: waiting };
      },
      saveDetections: async (options) => {
        calls.push("saveDetections");
        saved.push(options);
        waiting = [];
      },
      list: async () => {
        calls.push("list");
        return { items: [], nextCursor: null, total: 0 };
      },
    });
    const client = new NativeClient(plugin);
    await Promise.resolve();
    const request = { kind: "all" as const, search: "", limit: 10 };
    await client.listItems(request);
    expect(calls).toEqual(["undetected v1", "saveDetections", "list"]);
    expect(saved).toEqual([
      {
        detectorVersion: 1,
        items: [
          {
            id: "link",
            secrets: [],
            link: { url: "https://www.example.org/x", host: "example.org" },
          },
          {
            id: "secret",
            secrets: [{ start: 16, end: 20, label: "Password in URL" }],
            link: null,
          },
        ],
      },
    ]);

    calls.length = 0;
    await client.listItems(request);
    expect(calls).toEqual(["list"]);
    emit({ database: "teneo.sqlite" });
    await client.listItems(request);
    expect(calls).toEqual(["list", "undetected v1", "list"]);
  });

  test("a text nothing has looked at yet is listed with its secret found", async () => {
    // saved by the capture between the look and the list
    const captured: NativeItem = {
      ...nativeItem,
      id: "captured",
      text: "postgres://user:pa55@db.example.com/app",
      linkUrl: null,
      linkHost: null,
      detectorVersion: null,
    };
    const { plugin } = fakePlugin({
      undetected: async () => ({ items: [] }),
      list: async () => ({ items: [captured], nextCursor: null, total: 1 }),
      get: async () => ({ item: captured }),
    });
    const client = new NativeClient(plugin);
    const page = await client.listItems({ kind: "all", search: "", limit: 10 });
    const expected = [{ start: 16, end: 20, label: "Password in URL" }];
    expect(page.items[0]?.secrets).toEqual(expected);
    expect((await client.getItem("captured"))?.secrets).toEqual(expected);
  });

  test("a text looked at by older rules is looked at again when shown", () => {
    const old = toHistoryItem({
      ...nativeItem,
      text: "plain words",
      secrets: [{ start: 0, end: 5, label: "Old rule" }],
      linkUrl: null,
      linkHost: null,
      detectorVersion: 0,
    });
    expect(old.secrets).toEqual([]);
  });

  test("a text native code won't take detections for doesn't hold up the others", async () => {
    const saved: string[] = [];
    let waiting = [
      { id: "bad", text: "one" },
      { id: "good", text: "two" },
    ];
    let looks = 0;
    const { plugin, emit } = fakePlugin({
      undetected: async () => {
        looks++;
        return { items: waiting };
      },
      saveDetections: async ({ items }) => {
        if (items.some((item) => item.id === "bad")) {
          throw new Error("A secret is outside the text");
        }
        for (const item of items) saved.push(item.id);
        waiting = waiting.filter((text) => !saved.includes(text.id));
      },
      list: async () => ({ items: [], nextCursor: null, total: 0 }),
    });
    const client = new NativeClient(plugin);
    const request = { kind: "all" as const, search: "", limit: 10 };
    await client.listItems(request);
    expect(saved).toEqual(["good"]);

    // the bad one is left out from then on, not tried on every list
    looks = 0;
    emit({ database: "teneo.sqlite" });
    await client.listItems(request);
    expect(looks).toBe(1);
    expect(saved).toEqual(["good"]);
  });

  test("a text saved while it looks is looked at before the list", async () => {
    const calls: string[] = [];
    let rounds = 0;
    const { plugin, emit } = fakePlugin({
      undetected: async () => {
        rounds++;
        // the capture saves a text just after the first round read
        if (rounds === 1) emit({ database: "teneo.sqlite" });
        calls.push(`undetected ${rounds}`);
        return { items: [] };
      },
      list: async () => {
        calls.push("list");
        return { items: [], nextCursor: null, total: 0 };
      },
    });
    const client = new NativeClient(plugin);
    await Promise.resolve();
    await client.listItems({ kind: "all", search: "", limit: 10 });
    expect(calls).toEqual(["undetected 1", "undetected 2", "list"]);
  });

  test("when looking fails the history still lists, and the next list looks again", async () => {
    let looks = 0;
    const { plugin } = fakePlugin({
      undetected: async () => {
        looks++;
        throw new Error("The history couldn't be opened");
      },
      list: async () => ({ items: [nativeItem], nextCursor: null, total: 1 }),
    });
    const client = new NativeClient(plugin);
    const request = { kind: "all" as const, search: "", limit: 10 };
    expect((await client.listItems(request)).total).toBe(1);
    await client.listItems(request);
    expect(looks).toBe(2);
  });
});
