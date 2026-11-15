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
import { FakeSync } from "./fake-sync";
import {
  compareListKeys,
  copiedBefore,
  isAfterCursor,
  type ListKey,
  searchableText,
  truncateText,
} from "./history-rules";
import { createSeedItems } from "./seed-data";

/** Puts text on the clipboard, rejecting if it can't */
export type WriteText = (text: string) => Promise<void>;

const writeToBrowserClipboard: WriteText = async (text) => {
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    throw new Error("There is no clipboard to copy to");
  }
  await navigator.clipboard.writeText(text);
};

/** The history in memory, for the app in a browser and for tests. It lists,
 *  searches and trims as the phone's native history does. */
export class FakeClient implements TeneoClient {
  private items: ClipboardHistoryItem[];
  // when each pinned item was pinned; an item pinned from the start counts
  // as pinned when it was copied
  private pinnedAt = new Map<string, number>();
  private settings: MobileSettings;
  private sync = new FakeSync();
  private historyListeners = new Set<() => void>();
  private readonly writeText: WriteText;

  constructor(
    initialItems?: ClipboardHistoryItem[],
    writeText: WriteText = writeToBrowserClipboard,
  ) {
    this.writeText = writeText;
    this.items = initialItems ? [...initialItems] : createSeedItems();
    for (const item of this.items) {
      if (item.pinned) this.pinnedAt.set(item.id, item.dateCopied);
    }
    this.sortItems();
    this.settings = { ...defaultSettings };
  }

  private listKey(item: ClipboardHistoryItem): ListKey {
    return {
      pinnedAt: this.pinnedAt.get(item.id) ?? null,
      dateCopied: item.dateCopied,
      id: item.id,
    };
  }

  private sortItems(): void {
    this.items.sort((a, b) =>
      compareListKeys(this.listKey(a), this.listKey(b)),
    );
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

  private matches(item: ClipboardHistoryItem, query: string): boolean {
    const text = searchableText(
      item.text ?? "",
      item.secrets,
      this.settings.hideSecrets,
    );
    return (
      text.toLowerCase().includes(query) ||
      (item.sourceApp?.name?.toLowerCase().includes(query) ?? false) ||
      (item.link?.host.toLowerCase().includes(query) ?? false) ||
      item.secrets.some((secret) => secret.label.toLowerCase().includes(query))
    );
  }

  async listItems(request: ClipboardListRequest): Promise<ClipboardListPage> {
    const query = request.search?.trim().toLowerCase() ?? "";
    const matched = this.items.filter(
      (item) =>
        (request.kind === "all" || item.kind === request.kind) &&
        (!query || this.matches(item, query)),
    );
    const cursor = request.cursor;
    const after = cursor
      ? matched.filter((item) => isAfterCursor(this.listKey(item), cursor))
      : matched;

    const limit = Math.max(1, request.limit);
    const pageItems = after.slice(0, limit);
    const last = pageItems.at(-1);
    const nextCursor: ClipboardListCursor | null =
      after.length > limit && last ? this.listKey(last) : null;

    return {
      items: pageItems.map((item) => {
        if (item.text === null) return { ...item };
        const preview = truncateText(
          item.text,
          item.secrets,
          textPreviewLength,
        );
        return { ...item, ...preview };
      }),
      nextCursor,
      total: cursor ? null : matched.length,
    };
  }

  async getItem(id: string): Promise<ClipboardHistoryItem | null> {
    const item = this.items.find((i) => i.id === id);
    return item ? { ...item } : null;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    const item = this.items.find((i) => i.id === id);
    if (!item) {
      return;
    }

    item.pinned = pinned;
    if (pinned) this.pinnedAt.set(id, Date.now());
    else this.pinnedAt.delete(id);
    this.sortItems();
    this.notifyHistoryChanged();
  }

  async deleteItem(id: string): Promise<void> {
    const idx = this.items.findIndex((i) => i.id === id);
    if (idx === -1) {
      return;
    }

    this.items.splice(idx, 1);
    this.pinnedAt.delete(id);
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

  // a browser has no Mac to ask for its apps' icons
  async getAppIcons(): Promise<Record<string, string>> {
    return {};
  }

  onAppIconsChanged(): () => void {
    return () => {};
  }

  // a browser can't read other sites, so the sample links have no previews
  async getLinkPreview(): Promise<string | null> {
    return null;
  }

  async getLinkPreviewImage(): Promise<null> {
    return null;
  }

  async getSettings(): Promise<MobileSettings> {
    return { ...this.settings };
  }

  async updateSettings(
    changes: Partial<MobileSettings>,
  ): Promise<MobileSettings> {
    this.settings = { ...this.settings, ...changes };
    if ("historyRetentionDays" in changes || "maxItems" in changes) {
      this.applyLimits(Date.now());
    }
    return { ...this.settings };
  }

  /** Delete the unpinned items "Keep history for" and "Maximum items" no longer keep */
  private applyLimits(now: number): void {
    const before = copiedBefore(now, this.settings.historyRetentionDays);
    const maxItems = this.settings.maxItems;
    let unpinned = 0;
    const kept = this.items.filter((item) => {
      if (this.pinnedAt.has(item.id)) return true;
      // items are in list order, so the unpinned ones come newest first
      unpinned += 1;
      return (
        item.dateCopied >= before && (maxItems <= 0 || unpinned <= maxItems)
      );
    });
    if (kept.length === this.items.length) return;
    this.items = kept;
    this.notifyHistoryChanged();
  }

  getSyncStatus(): Promise<SyncStatus> {
    return this.sync.getSyncStatus();
  }

  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    return this.sync.onSyncStatusChanged(listener);
  }

  pair(code: string): Promise<PairResult> {
    return this.sync.pair(code);
  }

  unpair(): Promise<void> {
    return this.sync.unpair();
  }
}
