import type {
  ClipboardHistoryItem,
  ClipboardItemKind,
} from "../../shared/types/clipboard";

export type { ClipboardHistoryItem, ClipboardItemKind };

export interface ClipboardItemRow {
  id: string;
  kind: ClipboardItemKind;
  imageSize: string | null;
  path: string | null;
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
}

export interface ClipboardItemColumn {
  name: string;
}
