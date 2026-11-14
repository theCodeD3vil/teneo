import type { ClipboardHistoryItem } from "@/types/clipboard";

/** What copying the item puts back on the clipboard, or null when there's nothing. */
export function getClipboardData(
  item: ClipboardHistoryItem,
): TinyClipboardWrite | null {
  switch (item.kind) {
    case "text":
      return item.text === null
        ? null
        : { text: item.text, html: item.html ?? undefined };
    case "files":
      return item.paths.length ? { paths: item.paths } : null;
    case "image":
      if (!item.image) return null;
      return item.pasteAsFile ? { paths: [item.image] } : { image: item.image };
    case "color":
      return item.color ? { color: item.color } : null;
  }
}

// Copied image data has no filename: use the browser's <img src> name when there
// is one, otherwise label the image by the app it came from.
export function getImageName(item: ClipboardHistoryItem): string {
  const sourceAppName = item.sourceApp?.name;
  return (
    imageNameFromHtml(item.html) ??
    (sourceAppName ? `Image from ${sourceAppName}` : "Image")
  );
}

/** Original filename from a browser copy's `<img src>` html, or null. */
function imageNameFromHtml(html: string | null): string | null {
  const src = html?.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (!src) return null;
  try {
    const { protocol, pathname } = new URL(src);
    if (protocol === "data:") return null;
    return decodeURIComponent(pathname.split("/").pop() ?? "") || null;
  } catch {
    return null; // relative or malformed src
  }
}
