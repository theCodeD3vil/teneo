import type {
  ClipboardHistoryItem,
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
  getSettings(): Promise<MobileSettings>;
  updateSettings(changes: Partial<MobileSettings>): Promise<MobileSettings>;
  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void;
  pair(code: string): Promise<PairResult>;
  unpair(): Promise<void>;
}
