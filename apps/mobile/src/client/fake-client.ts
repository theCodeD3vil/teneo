import type {
  ClipboardHistoryItem,
  ClipboardListCursor,
  ClipboardListPage,
  ClipboardListRequest,
} from "@teneo/shared/types/clipboard";
import { textPreviewLength } from "@teneo/shared/types/clipboard";

import type { PairResult, TeneoClient } from "../types/client";
import { defaultSettings, type MobileSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";
import { createSeedItems } from "./seed-data";

/** Puts text on the clipboard, rejecting if it can't */
export type WriteText = (text: string) => Promise<void>;

const writeToBrowserClipboard: WriteText = async (text) => {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("There is no clipboard to copy to");
  }
  await navigator.clipboard.writeText(text);
};

export class FakeClient implements TeneoClient {
  private items: ClipboardHistoryItem[];
  private settings: MobileSettings;
  private syncStatus: SyncStatus;
  private historyListeners = new Set<() => void>();
  private syncListeners = new Set<(status: SyncStatus) => void>();
  private readonly writeText: WriteText;

  constructor(
    initialItems?: ClipboardHistoryItem[],
    writeText: WriteText = writeToBrowserClipboard,
  ) {
    this.writeText = writeText;
    this.items = initialItems ? [...initialItems] : createSeedItems();
    this.sortItems();
    this.settings = { ...defaultSettings };
    this.syncStatus = {
      state: "not_paired",
      devices: [],
    };
  }

  private sortItems(): void {
    this.items.sort((a, b) => {
      if (a.pinned !== b.pinned) {
        return a.pinned ? -1 : 1;
      }
      if (b.dateCopied !== a.dateCopied) {
        return b.dateCopied - a.dateCopied;
      }
      return b.id.localeCompare(a.id);
    });
  }

  private notifyHistoryChanged(): void {
    for (const listener of this.historyListeners) {
      try {
        listener();
      } catch {
        // Ignore listener error
      }
    }
  }

  private notifySyncStatusChanged(): void {
    const status = {
      ...this.syncStatus,
      devices: [...this.syncStatus.devices],
    };
    for (const listener of this.syncListeners) {
      try {
        listener(status);
      } catch {
        // Ignore listener error
      }
    }
  }

  async listItems(request: ClipboardListRequest): Promise<ClipboardListPage> {
    const query = request.search?.trim().toLowerCase() ?? "";

    // 1. Filter by kind and search term
    const matched = this.items.filter((item) => {
      if (request.kind !== "all" && item.kind !== request.kind) {
        return false;
      }

      if (!query) {
        return true;
      }

      const textMatch = item.text?.toLowerCase().includes(query) ?? false;
      const appMatch =
        item.sourceApp?.name?.toLowerCase().includes(query) ?? false;
      const urlMatch = item.sourceURL?.toLowerCase().includes(query) ?? false;
      const hostMatch = item.link?.host?.toLowerCase().includes(query) ?? false;
      const secretMatch = item.secrets.some((s) =>
        s.label.toLowerCase().includes(query),
      );

      return textMatch || appMatch || urlMatch || hostMatch || secretMatch;
    });

    // 2. Filter items after cursor if cursor is present
    let afterCursorItems = matched;
    if (request.cursor) {
      const cursor = request.cursor;
      const isCursorPinned = cursor.pinnedAt !== null;

      afterCursorItems = matched.filter((item) => {
        if (isCursorPinned) {
          if (!item.pinned) {
            return true;
          }
          if (item.dateCopied < cursor.dateCopied) {
            return true;
          }
          if (
            item.dateCopied === cursor.dateCopied &&
            item.id.localeCompare(cursor.id) < 0
          ) {
            return true;
          }
          return false;
        } else {
          if (item.pinned) {
            return false;
          }
          if (item.dateCopied < cursor.dateCopied) {
            return true;
          }
          if (
            item.dateCopied === cursor.dateCopied &&
            item.id.localeCompare(cursor.id) < 0
          ) {
            return true;
          }
          return false;
        }
      });
    }

    // 3. Slice page
    const limit = Math.max(1, request.limit);
    const pageItems = afterCursorItems.slice(0, limit);
    const hasMore = afterCursorItems.length > limit;

    let nextCursor: ClipboardListCursor | null = null;
    if (hasMore && pageItems.length > 0) {
      const last = pageItems[pageItems.length - 1];
      nextCursor = {
        pinnedAt: last.pinned ? last.dateCopied : null,
        dateCopied: last.dateCopied,
        id: last.id,
      };
    }

    // 4. Truncate long preview texts for list view
    const transformedItems = pageItems.map((item) => {
      if (item.text && item.text.length > textPreviewLength) {
        return {
          ...item,
          text: item.text.slice(0, textPreviewLength),
          isTruncated: true,
        };
      }
      return { ...item };
    });

    return {
      items: transformedItems,
      nextCursor,
      total: request.cursor ? null : matched.length,
    };
  }

  async getItem(id: string): Promise<ClipboardHistoryItem | null> {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      return null;
    }
    return { ...item };
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      return;
    }

    item.pinned = pinned;
    this.sortItems();
    this.notifyHistoryChanged();
  }

  async deleteItem(id: string): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) {
      return;
    }

    this.items.splice(idx, 1);
    this.notifyHistoryChanged();
  }

  async copyToClipboard(id: string): Promise<void> {
    const text = this.items.find((i) => i.id === id)?.text;
    if (text === undefined || text === null) {
      throw new Error("This item has no text to copy");
    }
    await this.writeText(text);
    // like the desktop app, putting an item back on the clipboard leaves the
    // history as it was: the copy isn't recorded again or moved to the top
  }

  async copyText(text: string): Promise<void> {
    await this.writeText(text);
  }

  onHistoryChanged(listener: () => void): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
    };
  }

  async getSettings(): Promise<MobileSettings> {
    return { ...this.settings };
  }

  async updateSettings(
    changes: Partial<MobileSettings>,
  ): Promise<MobileSettings> {
    this.settings = { ...this.settings, ...changes };
    return { ...this.settings };
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return { ...this.syncStatus, devices: [...this.syncStatus.devices] };
  }

  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    this.syncListeners.add(listener);
    return () => {
      this.syncListeners.delete(listener);
    };
  }

  async pair(code: string): Promise<PairResult> {
    const trimmed = code.trim();

    // The QR code's link (teneo://pair?v=1&k=<key>, then the Mac's addresses
    // and anything a later version adds) or a recovery code
    const isTeneoUri = /^teneo:\/\/pair\?v=1&k=[a-zA-Z0-9_-]+(&\S*)?$/.test(
      trimmed,
    );
    const isRecoveryCode =
      /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){2,5}$/.test(trimmed) ||
      /^[a-fA-F0-9]{32,64}$/.test(trimmed);

    if (!isTeneoUri && !isRecoveryCode) {
      return {
        ok: false,
        error:
          "Invalid pairing code. Expected a Teneo QR code or formatted recovery code.",
      };
    }

    this.syncStatus = {
      state: "connected",
      devices: [
        {
          id: "mac-host-01",
          name: "MacBook Pro",
          model: "MacBookPro18,1",
          lastSeen: Date.now(),
        },
      ],
    };

    this.notifySyncStatusChanged();
    return { ok: true, deviceName: "MacBook Pro" };
  }

  async unpair(): Promise<void> {
    this.syncStatus = {
      state: "not_paired",
      devices: [],
    };
    this.notifySyncStatusChanged();
  }
}
