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

/** A contextual hit, which may be a short password or an unfamiliar key. */
export const possibleCredentialLabel = "Possible credential";

/** Precomputed text preview actions stored in `ClipboardHistoryItem.actions`. */
export const ClipboardItemAction = {
  tidy: 1 << 0,
  formatJson: 1 << 1,
  qr: 1 << 2,
  contactEmail: 1 << 3,
  contactPhone: 1 << 4,
  copyErrorLine: 1 << 5,
} as const;

/** Stage at which `ClipboardHistoryItem.actions` was computed. */
export const ClipboardItemActionsVersion = {
  deterministic: 1,
  localAi: 2,
} as const;

export function hasClipboardAction(
  actions: number | null | undefined,
  flag: number,
): boolean {
  return typeof actions === "number" && (actions & flag) !== 0;
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

/** A link item preview's picture, and where it came from: a page's share
 *  image ("page", "home") fills the frame, a site icon sits small in it. */
export interface LinkPreviewImage {
  /** data: URL of a png */
  image: string;
  source: "page" | "home" | "icon";
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
  /** who made the device it was copied on, such as "google", when it came
   *  from another device that said so: the Mac shows that maker's logo by a
   *  phone's name */
  originMaker?: string | null;
  sourceURL: string | null;
  pinned: boolean;
  /** an image from a screenshot tool's temp file: copying it back puts the
   *  saved image on the clipboard as a file, as the tool itself does */
  pasteAsFile: boolean;
  /** bytes of a single copied file, read each time history is listed; null
   *  for a folder, a missing file, several files and other kinds */
  fileSize: number | null;
  /** secrets in the text, found when it's copied and stored with it; a rule
   *  added later is applied to older copies once at startup */
  secrets: SecretSpan[];
  /** set when the text is a link, found when it's copied and stored with it */
  link: ClipboardLink | null;
  /** precomputed text preview actions bitmask (ClipboardItemAction), or null
   *  for non-text items and rows saved before action caching */
  actions?: number | null;
  /** stage that computed `actions` (ClipboardItemActionsVersion) */
  actionsVersion?: number | null;
  /** the history list carries only the start of a long text (see
   *  textPreviewLength); the whole of it comes from the clipboardItem api */
  isTruncated: boolean;
}

/** How much of a text the history list carries. The card shows less; the
 *  preview, copy and paste fetch the whole text by id. */
export const textPreviewLength = 1000;

/** Which items the history list asks for; "all" takes every kind. */
export interface ClipboardListRequest {
  kind: ClipboardItemKind | "all";
  /** matched against the text, file paths, color and source app, case-insensitively */
  search: string;
  /** the last item of the page before; undefined for the first page */
  cursor?: ClipboardListCursor;
  limit: number;
}

/** Where a page ends: the sort keys of its last item (pinned first, newest
 *  first, then id), so the next page starts after it even if the history
 *  changed in between. */
export interface ClipboardListCursor {
  pinnedAt: number | null;
  dateCopied: number;
  id: string;
}

export interface ClipboardListPage {
  items: ClipboardHistoryItem[];
  /** null once there is no page after this one */
  nextCursor: ClipboardListCursor | null;
  /** how many items match the request in all; only the first page counts them */
  total: number | null;
}
