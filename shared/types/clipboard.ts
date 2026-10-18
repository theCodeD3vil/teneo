export type ClipboardItemKind = "files" | "image" | "color" | "text";

/** Backend event emitted after any committed clipboard-history mutation. */
export const clipboardHistoryChangedEvent = "clipboard-history-changed";

export interface ClipboardImageSize {
  width: number;
  height: number;
}

export interface ClipboardSourceApp {
  name: string | null;
  bundleId: string | null;
}

/** Data returned from the backend to every frontend window through tiny.api. */
export interface ClipboardHistoryItem {
  id: string;
  dateCopied: number;
  kind: ClipboardItemKind;
  changeCount: number;
  text: string | null;
  html: string | null;
  paths: string[];
  image: string | null;
  imageSize: ClipboardImageSize | null;
  color: string | null;
  concealed: boolean;
  sourceApp: ClipboardSourceApp | null;
  sourceURL: string | null;
}
