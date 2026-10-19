export { clipboardHistoryChangedEvent } from "../../shared/types/clipboard";
import type {
  ClipboardHistoryItem,
  ClipboardItemKind,
} from "../../shared/types/clipboard";

export type { ClipboardHistoryItem, ClipboardItemKind };

/** A clipboard read, ready for history; pasteAsFile marks an image saved from
 *  a screenshot tool's temp file, which pastes back as that file. */
export type ClipboardItemToSave = TinyClipboardData & { pasteAsFile?: boolean };

export interface ClipboardItemRow {
  id: string;
  kind: ClipboardItemKind;
  imageSize: string | null;
  path: string | null;
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pasteAsFile: number | null;
  /** 1 when value is encrypted, because the text holds a secret */
  encrypted: number | null;
}

export interface ClipboardItemColumn {
  name: string;
}
