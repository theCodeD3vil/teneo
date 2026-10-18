import type { ClipboardItemKind } from "./clipboard";

/** What Teneo's data folder holds, for Settings › Storage. */
export interface DataFolderUsage {
  /** total bytes: history database, saved images, app icons, settings */
  size: number;
  /** bytes counted against the storage limit, per kind of history item: its
   *  text, color or file list, plus its saved image */
  clipboardSizeByKind: Record<ClipboardItemKind, number>;
  /** image items in history */
  imageCount: number;
  /** files across every copied-files item in history */
  fileCount: number;
}
