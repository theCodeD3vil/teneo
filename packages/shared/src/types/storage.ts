import type { ClipboardItemKind } from "./clipboard";

/** What Teneo's data folder holds, for Settings › Storage. */
export interface DataFolderUsage {
  /** total bytes: history database, saved images, app icons, settings */
  size: number;
  /** bytes counted against the storage limit, per kind of unpinned history
   *  item: its text, color or file list, plus its saved image */
  clipboardSizeByKind: Record<ClipboardItemKind, number>;
  /** unpinned history items, the ones counted against the item limit */
  itemCount: number;
  /** image items in history */
  imageCount: number;
  /** files across every copied-files item in history */
  fileCount: number;
}

/** Whether macOS lets Teneo into one of the folders it protects. */
export interface FolderAccess {
  name: "Desktop" | "Documents" | "Downloads";
  /** missing: there's no such folder on this Mac */
  status: "granted" | "denied" | "missing";
}
