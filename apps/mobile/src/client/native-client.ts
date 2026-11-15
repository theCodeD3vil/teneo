import { findLink } from "@teneo/shared/detection/links";
import { findSecrets } from "@teneo/shared/detection/secrets";
import { detectionVersion } from "@teneo/shared/detection/version";
import type {
  ClipboardHistoryItem,
  ClipboardListPage,
  ClipboardListRequest,
} from "@teneo/shared/types/clipboard";

import type { PairResult, TeneoClient } from "../types/client";
import { defaultSettings, type MobileSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";
import {
  appDatabase,
  type DatabaseOption,
  type HistoryPlugin,
  type NativeItem,
} from "./history-plugin";
import type { NativeSync } from "./native-sync";

// texts looked at per round trip: few, as a text can be long
const detectionBatch = 10;

type Detection = Parameters<
  HistoryPlugin["saveDetections"]
>[0]["items"][number];

/**
 * The secrets and link of an item. Native code saves a captured or shared
 * text without looking for them, and the app looks before it lists
 * (detectNewTexts). A text saved between that look and the list still comes
 * through unlooked-at, so it is looked at here: a secret is never shown
 * unmasked. The list carries only the start of a long text, which is all it
 * shows; a link is the whole text or nothing, so a cut text keeps what is
 * stored.
 */
function detected(
  item: NativeItem,
): Pick<ClipboardHistoryItem, "secrets" | "link"> {
  const stored = {
    secrets: item.secrets,
    link:
      item.linkUrl && item.linkHost
        ? { url: item.linkUrl, host: item.linkHost }
        : null,
  };
  const isLookedAt =
    item.detectorVersion !== null && item.detectorVersion >= detectionVersion;
  if (isLookedAt || item.text === null) return stored;
  try {
    return {
      secrets: findSecrets(item.text),
      link: item.isTruncated ? stored.link : findLink(item.text),
    };
  } catch {
    return stored;
  }
}

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
    ...detected(item),
    isTruncated: item.isTruncated,
  };
}

/**
 * The phone's own history, kept by the Android app in its database
 * (HistoryPlugin.java), so it outlives the app and the sync service can
 * reach it. Pairing and sync status come from the sync service, through
 * NativeSync; without one (a test database) the phone is never paired.
 */
export class NativeClient implements TeneoClient {
  private readonly plugin: HistoryPlugin;
  private readonly database: DatabaseOption;
  private readonly databaseName: string;
  private historyListeners = new Set<() => void>();
  private readonly sync: NativeSync | null;
  private removeNativeListener: Promise<() => Promise<void>>;
  private mayHaveUndetected = true;
  // texts whose detections couldn't be made or saved: left out of later
  // rounds, so one bad text never holds up the others
  private readonly unsavable = new Set<string>();
  private detecting: Promise<void> | null = null;

  constructor(
    plugin: HistoryPlugin,
    options: DatabaseOption & { sync?: NativeSync } = {},
  ) {
    this.plugin = plugin;
    this.sync = options.sync ?? null;
    this.database = options.database ? { database: options.database } : {};
    this.databaseName = options.database ?? appDatabase;
    this.removeNativeListener = plugin
      .addListener("historyChanged", (event) => {
        if (event.database !== this.databaseName) return;
        this.mayHaveUndetected = true;
        this.notifyHistoryChanged();
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

  /**
   * Look for secrets and links in the texts native code saved without
   * looking (the capture and the share sheet), or looked at with older
   * rules. Done before the history is listed, so a secret is never shown
   * unmasked first, and only after a change could have left one to do.
   */
  private detectNewTexts(): Promise<void> {
    if (!this.mayHaveUndetected) return this.detecting ?? Promise.resolve();
    this.detecting ??= this.detectUntilSettled().finally(() => {
      this.detecting = null;
    });
    return this.detecting;
  }

  private async detectUntilSettled(): Promise<void> {
    // a text saved while a round runs may be past what it read: look again
    while (this.mayHaveUndetected) {
      this.mayHaveUndetected = false;
      try {
        await this.detectAll();
      } catch {
        // the list still shows; the next one tries again
        this.mayHaveUndetected = true;
        return;
      }
    }
  }

  private async detectAll(): Promise<void> {
    for (;;) {
      // the newest come first, so ask past the ones that are being left out
      const limit = detectionBatch + this.unsavable.size;
      const { items } = await this.plugin.undetected({
        ...this.database,
        detectorVersion: detectionVersion,
        limit,
      });
      const found: Detection[] = [];
      for (const { id, text } of items) {
        if (this.unsavable.has(id)) continue;
        try {
          found.push({ id, secrets: findSecrets(text), link: findLink(text) });
        } catch {
          this.unsavable.add(id);
        }
      }
      if (found.length === 0) return;
      await this.saveDetections(found);
      if (items.length < limit) return;
    }
  }

  /** Save them together; if native code refuses the lot, one by one, so a
   *  text it won't take doesn't cost the others theirs */
  private async saveDetections(found: Detection[]): Promise<void> {
    const save = (items: Detection[]) =>
      this.plugin.saveDetections({
        ...this.database,
        detectorVersion: detectionVersion,
        items,
      });
    try {
      await save(found);
    } catch (error) {
      if (found.length === 1) {
        this.unsavable.add(found[0]!.id);
        return;
      }
      let savedAny = false;
      for (const one of found) {
        try {
          await save([one]);
          savedAny = true;
        } catch {
          this.unsavable.add(one.id);
        }
      }
      // none could be saved: the history itself is the trouble, not a text
      if (!savedAny) {
        for (const one of found) this.unsavable.delete(one.id);
        throw error;
      }
    }
  }

  async listItems(request: ClipboardListRequest): Promise<ClipboardListPage> {
    await this.detectNewTexts();
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
    await this.detectNewTexts();
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
    const saved = { ...defaultSettings, ...settings };
    if (
      this.sync &&
      ("backgroundReceive" in changes || "syncSecrets" in changes)
    ) {
      // the service starts, stops or changes what it sends by them
      try {
        await this.sync.settingsChanged();
      } catch {
        // saved all the same; the service reads them again when it next starts
      }
      if (changes.backgroundReceive) void this.askForNotifications();
    }
    return saved;
  }

  getSyncStatus(): Promise<SyncStatus> {
    return this.sync?.getSyncStatus() ?? Promise.resolve(notPaired());
  }

  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    return this.sync?.onSyncStatusChanged(listener) ?? (() => {});
  }

  async pair(code: string): Promise<PairResult> {
    if (!this.sync) return { ok: false, error: "Sync isn't available here" };
    const result = await this.sync.pair(code);
    if (result.ok) void this.askForNotifications();
    return result;
  }

  async unpair(): Promise<void> {
    await this.sync?.unpair();
  }

  /** Sync in the background shows a notification: ask for it once sync is
   *  on in the background, when the user can see why */
  private async askForNotifications(): Promise<void> {
    try {
      const { backgroundReceive } = await this.getSettings();
      const status = await this.getSyncStatus();
      if (!backgroundReceive || status.state === "not_paired") return;
      await this.sync?.requestNotifications();
    } catch {
      // sync runs without it; the notification is only hidden
    }
  }
}

function notPaired(): SyncStatus {
  return { state: "not_paired", devices: [] };
}
