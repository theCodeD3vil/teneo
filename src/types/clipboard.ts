export { clipboardHistoryChangedEvent } from "../../shared/types/clipboard";
export type {
  ClipboardHistoryItem,
  ClipboardItemKind,
  FilePreview,
  SecretSpan,
} from "../../shared/types/clipboard";

export const clipboardItemVariants = [
  "all",
  "files",
  "image",
  "color",
  "text",
  "empty",
] as const;
export type ClipboardItemVariant = (typeof clipboardItemVariants)[number];

export type TabVariant = Exclude<ClipboardItemVariant, "empty">;
export type MediaVariant = Extract<ClipboardItemVariant, "image" | "files">;
