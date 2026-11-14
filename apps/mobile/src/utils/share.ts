import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";

/** Hand the item's text or link to Android's share sheet. */
export async function shareItem(item: ClipboardHistoryItem): Promise<void> {
  const text = item.link?.url ?? item.text ?? item.color;
  if (!text || typeof navigator.share !== "function") return;
  try {
    await navigator.share(item.link ? { url: text } : { text });
  } catch {
    // dismissed
  }
}
