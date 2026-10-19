// Applies the Storage settings ("Keep history for", "Maximum items",
// "Storage limit") and "Clear history" to the clipboard history.
import {
  type AppSettings,
  type HistoryDuration,
  pickSettings,
} from "../shared/types/settings";
import {
  countClipboardItemsToDelete,
  deleteClipboardItems,
  listClipboardItemSizes,
} from "./database";
import { logError } from "./files";
import { getSettings } from "./settings";

const day = 24 * 60 * 60 * 1000;
const historyDurations: Record<HistoryDuration, number | null> = {
  day,
  week: 7 * day,
  month: 30 * day,
  year: 365 * day,
  forever: null,
};
// Items age even when nothing new is copied, so limits are re-applied hourly
const trimInterval = 60 * 60 * 1000;

/** Delete items past the current history limits. */
export async function trimClipboardHistory(app: TinyApp): Promise<void> {
  const { copiedBefore, keepNewest } = await getTrimLimits(app, getSettings());
  await deleteClipboardItems(app, copiedBefore, keepNewest);
}

/** How many items saving these setting changes would delete, so the page
 *  can confirm before anything is lost. */
export async function countItemsDeletedBy(
  changes: unknown,
  app: TinyApp,
): Promise<number> {
  const settings = { ...getSettings(), ...pickSettings(changes) };
  const { copiedBefore, keepNewest } = await getTrimLimits(app, settings);
  return countClipboardItemsToDelete(app, copiedBefore, keepNewest);
}

/** The settings' limits in deleteClipboardItems's terms. */
async function getTrimLimits(
  app: TinyApp,
  { historyDuration, maximumItems, maximumStorage }: AppSettings,
): Promise<{ copiedBefore: number; keepNewest: number }> {
  const keepFor = historyDurations[historyDuration] ?? null;
  const keepNewest = Math.min(
    maximumItems > 0 ? Math.floor(maximumItems) : Infinity,
    maximumStorage > 0
      ? await countItemsWithinStorage(app, maximumStorage)
      : Infinity,
  );
  return {
    copiedBefore: keepFor === null ? 0 : Date.now() - keepFor,
    keepNewest: Number.isFinite(keepNewest) ? keepNewest : -1,
  };
}

/** How many of the newest unpinned items fit in maximumStorage bytes. */
async function countItemsWithinStorage(
  app: TinyApp,
  maximumStorage: number,
): Promise<number> {
  const itemSizes = await listClipboardItemSizes(app);
  let usedBytes = 0;
  let count = 0;
  for (const { bytes, pinned } of itemSizes) {
    if (pinned) continue;
    usedBytes += bytes;
    if (usedBytes > maximumStorage) break;
    count += 1;
  }
  // The newest item stays even if it alone is over the limit: deleting
  // what was just copied would look like the copy never happened
  return Math.max(count, 1);
}

export function clearClipboardHistory(app: TinyApp): Promise<void> {
  return deleteClipboardItems(app, 0, 0);
}

export function startTrimmingClipboardHistory(app: TinyApp): void {
  const trim = () =>
    trimClipboardHistory(app).catch((error: unknown) =>
      logError("trimming clipboard history failed:", error),
    );
  void trim();
  setInterval(trim, trimInterval);
}
