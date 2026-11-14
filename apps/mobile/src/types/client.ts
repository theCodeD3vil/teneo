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
  copyToClipboard(id: string): Promise<void>;
  onHistoryChanged(listener: () => void): () => void;
  getSettings(): Promise<MobileSettings>;
  updateSettings(changes: Partial<MobileSettings>): Promise<MobileSettings>;
  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void;
  pair(code: string): Promise<PairResult>;
  unpair(): Promise<void>;
}
