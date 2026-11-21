import type {
  ClipboardHistoryItem,
  LinkPreviewImage,
  ClipboardListPage,
  ClipboardListRequest,
} from "@teneo/shared/types/clipboard";

import type { MobileSettings } from "./settings";
import type { SyncStatus } from "./sync";

export interface PairResult {
  ok: boolean;
  error?: string;
  deviceName?: string;
}

export interface TeneoClient {
  listItems(request: ClipboardListRequest): Promise<ClipboardListPage>;
  getItem(id: string): Promise<ClipboardHistoryItem | null>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  deleteItem(id: string): Promise<void>;
  /** Put the item on the phone's clipboard. Rejects if nothing was put
   *  there, so "Copied" is only said for a copy that happened. */
  copyToClipboard(id: string): Promise<void>;
  /** Put text that isn't an item's own on the clipboard, such as an item's
   *  text in another case. Rejects like `copyToClipboard`. */
  copyText(text: string): Promise<void>;
  onHistoryChanged(listener: () => void): () => void;
  /** The icons of the Mac apps with these names, each a data: URL, by
   *  name. An app the phone has no icon for is left out: sync asks a Mac
   *  for it, and `onAppIconsChanged` says when one has come. */
  getAppIcons(names: string[]): Promise<Record<string, string>>;
  onAppIconsChanged(listener: () => void): () => void;
  /** A link's small picture for its card, as a data: URL. Null when
   *  previews are off or the site has none; rejects when the site can't
   *  be reached, so it can be asked again. */
  getLinkPreview(url: string): Promise<string | null>;
  /** The picture for a link's own preview, and where it came from */
  getLinkPreviewImage(url: string): Promise<LinkPreviewImage | null>;
  getSettings(): Promise<MobileSettings>;
  updateSettings(changes: Partial<MobileSettings>): Promise<MobileSettings>;
  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void;
  pair(code: string): Promise<PairResult>;
  unpair(): Promise<void>;
  /** Stop syncing with one device, until it is paired again. The others
   *  carry on. */
  removeDevice(id: string): Promise<void>;
}
