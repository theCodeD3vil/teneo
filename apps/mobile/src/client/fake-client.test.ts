import { describe, expect, test } from "bun:test";

import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";

import { FakeClient } from "./fake-client";

function makeItem(
  id: string,
  text: string,
  dateCopied: number,
  pinned = false,
  appName = "VS Code",
): ClipboardHistoryItem {
  return {
    id,
    dateCopied,
    kind: "text",
    changeCount: 1,
    text,
    html: null,
    paths: [],
    image: null,
    imageSize: null,
    color: null,
    concealed: false,
    sourceApp: { name: appName, bundleId: null },
    sourceURL: null,
    pinned,
    pasteAsFile: false,
    fileSize: null,
    secrets: [],
    link: null,
    isTruncated: false,
  };
}

describe("FakeClient", () => {
  describe("Paging", () => {
    test("pages through items with cursor and counts total on first page", async () => {
      const items: ClipboardHistoryItem[] = [
        makeItem("item-1", "First item", 5000, true),
        makeItem("item-2", "Second item", 4000, false),
        makeItem("item-3", "Third item", 3000, false),
        makeItem("item-4", "Fourth item", 2000, false),
        makeItem("item-5", "Fifth item", 1000, false),
      ];
      const client = new FakeClient(items);

      // Page 1
      const page1 = await client.listItems({
        kind: "all",
        search: "",
        limit: 2,
      });

      expect(page1.items.length).toBe(2);
      expect(page1.items[0].id).toBe("item-1");
      expect(page1.items[1].id).toBe("item-2");
      expect(page1.total).toBe(5);
      expect(page1.nextCursor).not.toBeNull();

      // Page 2
      const page2 = await client.listItems({
        kind: "all",
        search: "",
        limit: 2,
        cursor: page1.nextCursor!,
      });

      expect(page2.items.length).toBe(2);
      expect(page2.items[0].id).toBe("item-3");
      expect(page2.items[1].id).toBe("item-4");
      expect(page2.total).toBeNull();
      expect(page2.nextCursor).not.toBeNull();

      // Page 3 (final)
      const page3 = await client.listItems({
        kind: "all",
        search: "",
        limit: 2,
        cursor: page2.nextCursor!,
      });

      expect(page3.items.length).toBe(1);
      expect(page3.items[0].id).toBe("item-5");
      expect(page3.nextCursor).toBeNull();
    });

    test("truncates text preview in listItems but returns full text in getItem", async () => {
      const longText = "x".repeat(1500);
      const items = [makeItem("item-long", longText, 1000)];
      const client = new FakeClient(items);

      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });

      expect(page.items[0].text?.length).toBe(1000);
      expect(page.items[0].isTruncated).toBe(true);

      const fullItem = await client.getItem("item-long");
      expect(fullItem?.text?.length).toBe(1500);
    });
  });

  describe("Search", () => {
    test("filters by text case-insensitively", async () => {
      const items = [
        makeItem("item-1", "SELECT * FROM users", 3000),
        makeItem("item-2", "git checkout -b feature", 2000),
        makeItem("item-3", "select id from accounts", 1000),
      ];
      const client = new FakeClient(items);

      const result = await client.listItems({
        kind: "all",
        search: "select",
        limit: 10,
      });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.items.map((i) => i.id)).toEqual(["item-1", "item-3"]);
    });

    test("filters by source application name", async () => {
      const items = [
        makeItem("item-1", "alpha", 3000, false, "Safari"),
        makeItem("item-2", "beta", 2000, false, "Terminal"),
        makeItem("item-3", "gamma", 1000, false, "Safari"),
      ];
      const client = new FakeClient(items);

      const result = await client.listItems({
        kind: "all",
        search: "terminal",
        limit: 10,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe("item-2");
    });

    test("filters by secret label", async () => {
      const itemWithSecret = makeItem(
        "item-secret",
        "ghp_1234567890abcdef",
        1000,
      );
      itemWithSecret.secrets = [{ start: 0, end: 20, label: "GitHub token" }];
      const items = [
        itemWithSecret,
        makeItem("item-plain", "plain text", 2000),
      ];
      const client = new FakeClient(items);

      const result = await client.listItems({
        kind: "all",
        search: "github token",
        limit: 10,
      });

      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe("item-secret");
    });
  });

  describe("Pinning and Ordering", () => {
    test("pinned items sort before unpinned items", async () => {
      const items = [
        makeItem("item-1", "older pinned", 1000, true),
        makeItem("item-2", "newer unpinned", 5000, false),
        makeItem("item-3", "newest pinned", 3000, true),
      ];
      const client = new FakeClient(items);

      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });

      expect(page.items.map((i) => i.id)).toEqual([
        "item-3",
        "item-1",
        "item-2",
      ]);
    });

    test("setPinned updates pinned status and reorders items", async () => {
      const items = [
        makeItem("item-1", "first", 3000, false),
        makeItem("item-2", "second", 2000, false),
      ];
      const client = new FakeClient(items);

      let historyChangedCount = 0;
      const unsubscribe = client.onHistoryChanged(() => {
        historyChangedCount++;
      });

      await client.setPinned("item-2", true);

      expect(historyChangedCount).toBe(1);

      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });
      expect(page.items[0].id).toBe("item-2");
      expect(page.items[0].pinned).toBe(true);

      unsubscribe();
    });
  });

  describe("Deletion", () => {
    test("deleteItem removes item and notifies listeners", async () => {
      const items = [
        makeItem("item-1", "first", 3000),
        makeItem("item-2", "second", 2000),
      ];
      const client = new FakeClient(items);

      let historyChanged = false;
      client.onHistoryChanged(() => {
        historyChanged = true;
      });

      await client.deleteItem("item-1");

      expect(historyChanged).toBe(true);

      const fetched = await client.getItem("item-1");
      expect(fetched).toBeNull();

      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });
      expect(page.items.length).toBe(1);
      expect(page.items[0].id).toBe("item-2");
    });
  });

  describe("Settings", () => {
    test("reads and updates mobile settings", async () => {
      const client = new FakeClient([]);
      const initial = await client.getSettings();
      expect(initial.hideSecrets).toBe(true);

      const updated = await client.updateSettings({
        hideSecrets: false,
        maxItems: 1000,
      });
      expect(updated.hideSecrets).toBe(false);
      expect(updated.maxItems).toBe(1000);

      const readAgain = await client.getSettings();
      expect(readAgain.hideSecrets).toBe(false);
    });
  });

  describe("Pairing and Sync", () => {
    test("rejects invalid pairing code", async () => {
      const client = new FakeClient([]);
      const result = await client.pair("not-a-valid-code");
      expect(result.ok).toBe(false);
      expect(result.error).toBeDefined();

      const status = await client.getSyncStatus();
      expect(status.state).toBe("not_paired");
    });

    test("accepts valid Teneo URI and recovery codes", async () => {
      const client = new FakeClient([]);
      let syncStatusUpdates = 0;
      client.onSyncStatusChanged(() => {
        syncStatusUpdates++;
      });

      // QR URI format
      const qrResult = await client.pair(
        "teneo://pair?v=1&k=pub_secret123key456",
      );
      expect(qrResult.ok).toBe(true);
      expect(qrResult.deviceName).toBe("MacBook Pro");
      expect(syncStatusUpdates).toBe(1);

      let status = await client.getSyncStatus();
      expect(status.state).toBe("connected");
      expect(status.devices.length).toBe(1);
      expect(status.devices[0].name).toBe("MacBook Pro");

      await client.unpair();
      expect(syncStatusUpdates).toBe(2);

      status = await client.getSyncStatus();
      expect(status.state).toBe("not_paired");
      expect(status.devices.length).toBe(0);

      // Recovery code format
      const recoveryResult = await client.pair("ABCD-1234-EFGH-5678");
      expect(recoveryResult.ok).toBe(true);
      expect(recoveryResult.deviceName).toBe("MacBook Pro");
      expect(syncStatusUpdates).toBe(3);
    });
  });
});
