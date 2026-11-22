import { fetchClipboardItem } from "@/composables/useClipboard";
import { showCopiedNotice } from "@/composables/useCopiedNotice";
import type { ClipboardHistoryItem } from "@/types/clipboard";

import { getClipboardData } from "./clipboard-items";
import { notifyPanelVisibility, resetPanel } from "./panel-reset";

export interface CopyItemOptions {
  /** put the panel away once the item is on the clipboard */
  hideWindow?: boolean;
  /** then paste it into the app the user was in */
  paste?: boolean;
}

/** Put a history item back on the clipboard. The list carries only the start
 *  of a long text, so such an item is fetched whole first. False when there
 *  was nothing to copy, e.g. the item has gone from the history meanwhile. */
export async function copyItemToClipboard(
  item: ClipboardHistoryItem,
  { hideWindow = false, paste = false }: CopyItemOptions = {},
): Promise<boolean> {
  const wholeItem = item.isTruncated ? await fetchClipboardItem(item.id) : item;
  const clipboardData = wholeItem && getClipboardData(wholeItem);
  if (!clipboardData) return false;

  await tiny.clipboard.write(clipboardData);
  showCopiedNotice();
  if (hideWindow) {
    await tiny.api.call("hidePanel");
    notifyPanelVisibility(false);
  }
  // after the hide, focus is back in the app the user was typing in
  if (paste) await pasteIntoFrontmostApp();
  // last, so the paste isn't held up behind the list re-rendering
  if (hideWindow) resetPanel();
  return true;
}

// Posting ⌘V needs Accessibility. Without it the item stays copied for a
// manual paste; setup and Settings are the only places that request access.
async function pasteIntoFrontmostApp(): Promise<void> {
  if ((await tiny.app.permissions.check("accessibility")) === "granted")
    await tiny.app.paste();
}
