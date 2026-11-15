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
});
