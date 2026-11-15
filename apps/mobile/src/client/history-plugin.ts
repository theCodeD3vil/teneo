import type { PluginListenerHandle } from "@capacitor/core";
import type {
  ClipboardItemKind,
  ClipboardLink,
  ClipboardListCursor,
  SecretSpan,
} from "@teneo/shared/types/clipboard";

import type { MobileSettings } from "../types/settings";

/** An item as the native history hands it over */
export interface NativeItem {
  id: string;
  dateCopied: number;
  text: string | null;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinned: boolean;
  secrets: SecretSpan[];
  linkUrl: string | null;
  linkHost: string | null;
  isTruncated: boolean;
  /** which detection rules found `secrets` and the link; null if none looked */
  detectorVersion: number | null;
}

/** Which database a call is for: a test database's name (debug builds
 *  only), or none for the app's history */
export interface DatabaseOption {
  database?: string;
}

export interface TextToSave extends DatabaseOption {
  text: string;
  sourceAppName?: string | null;
  sourceAppBundleId?: string | null;
  secrets?: SecretSpan[];
  link?: ClipboardLink | null;
  /** which detection rules found the secrets and link */
  detectorVersion?: number;
  /** for a test database only: when it was copied */
  dateCopied?: number;
}

/** HistoryPlugin.java in the Android app */
export interface HistoryPlugin {
  list(
    options: DatabaseOption & {
      kind: ClipboardItemKind | "all";
      search: string;
      cursor?: ClipboardListCursor;
      limit: number;
    },
  ): Promise<{
    items: NativeItem[];
    nextCursor: ClipboardListCursor | null;
    total: number | null;
  }>;
  get(options: DatabaseOption & { id: string }): Promise<{
    item: NativeItem | null;
  }>;
  setPinned(
    options: DatabaseOption & { id: string; pinned: boolean },
  ): Promise<void>;
  delete(options: DatabaseOption & { id: string }): Promise<void>;
  copy(options: DatabaseOption & { id: string }): Promise<void>;
  copyText(options: DatabaseOption & { text: string }): Promise<void>;
  getSettings(
    options: DatabaseOption,
  ): Promise<{ settings: Partial<MobileSettings> }>;
  updateSettings(
    options: DatabaseOption & { changes: Partial<MobileSettings> },
  ): Promise<{ settings: Partial<MobileSettings> }>;
  saveText(options: TextToSave): Promise<{ id: string }>;
  /** texts that no rules of `detectorVersion` have looked at, newest first */
  undetected(
    options: DatabaseOption & { detectorVersion: number; limit: number },
  ): Promise<{ items: { id: string; text: string }[] }>;
  /** store what the rules of `detectorVersion` found in each text */
  saveDetections(
    options: DatabaseOption & {
      detectorVersion: number;
      items: {
        id: string;
        secrets: SecretSpan[];
        link: ClipboardLink | null;
      }[];
    },
  ): Promise<void>;
  resetTestDatabase(options: { database: string }): Promise<void>;
  /** The icons of the Mac apps with these names, each a png data: URL; an
   *  app the phone has no icon for is left out */
  appIcons(options: {
    names: string[];
  }): Promise<{ icons: Record<string, string> }>;
  addListener(
    event: "historyChanged",
    listener: (event: { database: string }) => void,
  ): Promise<PluginListenerHandle>;
  /** Sync saved an icon for an app that had none */
  addListener(
    event: "appIconsChanged",
    listener: () => void,
  ): Promise<PluginListenerHandle>;
}

/** The app's own history, as HistoryDatabase.java names it */
export const appDatabase = "teneo.sqlite";
