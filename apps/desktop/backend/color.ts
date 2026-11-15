import { getCssColor } from "@teneo/shared/detection/colors";

export { getCssColor };

/** Converts plain-text color clipboard data into TinyJS's existing color shape. */
export function normalizeClipboardColor(
  item: TinyClipboardData,
): TinyClipboardData {
  if (item.kind !== "text") return item;

  const color = getCssColor(item.text);
  if (!color) return item;

  return {
    ...item,
    kind: "color",
    text: null,
    html: null,
    paths: [],
    image: null,
    imageSize: null,
    color,
  };
}
