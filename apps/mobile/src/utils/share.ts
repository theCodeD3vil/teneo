import { Capacitor, registerPlugin } from "@capacitor/core";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";

/** Android's share sheet, through SharePlugin.java in the Android app */
interface SharePlugin {
  share(options: { text: string }): Promise<void>;
}

const Share = registerPlugin<SharePlugin>("Share");

/**
 * Hand the item's text or link to the share sheet. The list carries only the
 * start of a long text, so pass the whole item (see `client.getItem`).
 * Rejects if the sheet couldn't be opened.
 */
export async function shareItem(item: ClipboardHistoryItem): Promise<void> {
  const text = item.link?.url ?? item.text ?? item.color;
  if (!text) return;
  // the app's web view has no navigator.share
  if (Capacitor.isNativePlatform()) {
    await Share.share({ text });
    return;
  }
  if (typeof navigator.share !== "function") return;
  try {
    await navigator.share(item.link ? { url: text } : { text });
  } catch (caught) {
    // backing out of the sheet is not a failure
    if (caught instanceof DOMException && caught.name === "AbortError") return;
    throw caught;
  }
}
