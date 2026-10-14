export const clipboardItemVariants = [
  "files",
  "image",
  "color",
  "text",
  "empty",
] as const;
export type ClipboardItemVariant = (typeof clipboardItemVariants)[number];

export type TabVariant = Exclude<ClipboardItemVariant, "empty">;
export type MediaVariant = Extract<ClipboardItemVariant, "image" | "files">;
