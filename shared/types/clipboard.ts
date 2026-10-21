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

/** Where a secret, such as an API key, sits in an item's text: text.slice(start, end) */
export interface SecretSpan {
  start: number;
  end: number;
  /** what kind of secret it is, such as "GitHub token" */
  label: string;
}

/** What the filePreview API returns for a copied file or saved image. */
export interface FilePreview {
  /** data: URL of its Quick Look thumbnail, or null when there's none */
  url: string | null;
  /** the file was moved or deleted since it was copied. False when macOS
   *  only keeps Teneo out of its folder: it can still be pasted. */
  isMissing: boolean;
}

/** A copied text that is a single http(s) URL. */
export interface ClipboardLink {
  url: string;
  /** shown under the link, without "www." */
  host: string;
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
  pinned: boolean;
  /** an image from a screenshot tool's temp file: copying it back puts the
   *  saved image on the clipboard as a file, as the tool itself does */
  pasteAsFile: boolean;
  /** bytes of a single copied file, read each time history is listed; null
   *  for a folder, a missing file, several files and other kinds */
  fileSize: number | null;
  /** secrets in the text, found each time history is listed, so a rule
   *  added later covers older copies too */
  secrets: SecretSpan[];
  /** set when the text is a link, found each time history is listed */
  link: ClipboardLink | null;
}
