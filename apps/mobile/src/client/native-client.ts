import type {
  ClipboardHistoryItem,
  ClipboardListPage,
  ClipboardListRequest,
} from "@teneo/shared/types/clipboard";

import type { PairResult, TeneoClient } from "../types/client";
import { defaultSettings, type MobileSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";
import { FakeSync } from "./fake-sync";
import {
  appDatabase,
  type DatabaseOption,
  type HistoryPlugin,
  type NativeItem,
} from "./history-plugin";

/** The item the app shows for one the native history handed over */
export function toHistoryItem(item: NativeItem): ClipboardHistoryItem {
  return {
    id: item.id,
    dateCopied: item.dateCopied,
    kind: "text",
    changeCount: item.dateCopied,
    text: item.text,
    html: null,
    paths: [],
    image: null,
    imageSize: null,
    color: null,
    concealed: false,
    sourceApp:
      item.sourceAppName === null && item.sourceAppBundleId === null
        ? null
        : { name: item.sourceAppName, bundleId: item.sourceAppBundleId },
    sourceURL: null,
    pinned: item.pinned,
    pasteAsFile: false,
    fileSize: null,
    secrets: item.secrets,
    link:
      item.linkUrl && item.linkHost
        ? { url: item.linkUrl, host: item.linkHost }
        : null,
    isTruncated: item.isTruncated,
  };
}

/**
 * The phone's own history, kept by the Android app in its database
 * (HistoryPlugin.java), so it outlives the app and a later background
 * service can reach it. Pairing and sync are still the fake ones.
 */
export class NativeClient implements TeneoClient {
  private readonly plugin: HistoryPlugin;
  private readonly database: DatabaseOption;
  private readonly databaseName: string;
  private historyListeners = new Set<() => void>();
  private sync = new FakeSync();
  private removeNativeListener: Promise<() => Promise<void>>;

  constructor(plugin: HistoryPlugin, options: DatabaseOption = {}) {
    this.plugin = plugin;
    this.database = options.database ? { database: options.database } : {};
    this.databaseName = options.database ?? appDatabase;
    this.removeNativeListener = plugin
      .addListener("historyChanged", (event) => {
        if (event.database === this.databaseName) this.notifyHistoryChanged();
      })
      .then((handle) => () => handle.remove());
  }

  /** Stop hearing of changes to the history */
  async close(): Promise<void> {
    this.historyListeners.clear();
    await (
      await this.removeNativeListener
    )();
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

  async listItems(request: ClipboardListRequest): Promise<ClipboardListPage> {
    const page = await this.plugin.list({
      ...this.database,
      kind: request.kind,
      search: request.search ?? "",
      limit: request.limit,
      ...(request.cursor && { cursor: request.cursor }),
    });
    return {
      items: page.items.map(toHistoryItem),
      nextCursor: page.nextCursor,
      total: page.total,
    };
  }

  async getItem(id: string): Promise<ClipboardHistoryItem | null> {
    const { item } = await this.plugin.get({ ...this.database, id });
    return item ? toHistoryItem(item) : null;
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.plugin.setPinned({ ...this.database, id, pinned });
  }

  async deleteItem(id: string): Promise<void> {
    await this.plugin.delete({ ...this.database, id });
  }

  async copyToClipboard(id: string): Promise<void> {
    // the history stays as it was: Teneo doesn't save its own copies
    await this.plugin.copy({ ...this.database, id });
  }

  async copyText(text: string): Promise<void> {
    await this.plugin.copyText({ ...this.database, text });
  }

  onHistoryChanged(listener: () => void): () => void {
    this.historyListeners.add(listener);
    return () => {
      this.historyListeners.delete(listener);
    };
  }

  async getSettings(): Promise<MobileSettings> {
    const { settings } = await this.plugin.getSettings(this.database);
    const unsaved = Object.fromEntries(
      Object.entries(defaultSettings).filter(([key]) => !(key in settings)),
    );
    if (Object.keys(unsaved).length === 0) {
      return { ...defaultSettings, ...settings };
    }
    // The first start saves the defaults: native code that reads a setting
    // without the app (the history limits, later the capture and sync)
    // then goes by what the app shows
    return this.updateSettings(unsaved);
  }

  async updateSettings(
    changes: Partial<MobileSettings>,
  ): Promise<MobileSettings> {
    const { settings } = await this.plugin.updateSettings({
      ...this.database,
      changes,
    });
    return { ...defaultSettings, ...settings };
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
