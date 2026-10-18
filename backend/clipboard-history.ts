// Turns a clipboard change into a history item. Anything that only exists for a
// moment (the image's temp file, the source app) is saved to the data dir now.
import { saveAppIcon } from "./app-icons";
import { normalizeClipboardColor } from "./color";
import { isExcludedApp } from "./excluded-apps";
import { dataFolder, logError } from "./files";
import { getSettings } from "./settings";
import { generateUUID } from "./utils/uuid-generator";

function isFromPasswordManager(item: TinyClipboardData): boolean {
  // concealed = the org.nspasteboard marker well-behaved password managers set
  if (item.concealed) return true;
  const bundleId = item.sourceApp?.bundleId;
  return bundleId != null && isExcludedApp(bundleId);
}

/** Read the clipboard as a history item, or null for items history must skip. */
export async function readClipboardItem(
  app: TinyApp,
): Promise<TinyClipboardData | null> {
  const item = await app.clipboard.read();
  if (item.kind === "empty") return null;
  if (getSettings().ignorePasswords && isFromPasswordManager(item)) return null;

  const bundleId = item.sourceApp?.bundleId;
  if (bundleId) {
    // a missing icon must not cost the user their history item
    await saveAppIcon(bundleId, app).catch((error) =>
      logError(`saving icon for ${bundleId} failed:`, error),
    );
  }
  return normalizeClipboardColor(await saveClipboardImage(item, app));
}

/** Copy a clipboard image out of its temp file, which is replaced on the next
 *  copy. Returns the item pointing at the saved copy. */
async function saveClipboardImage(
  item: TinyClipboardData,
  app: TinyApp,
): Promise<TinyClipboardData> {
  if (item.kind !== "image" || !item.image) return item;
  // changeCount restarts at boot, so the timestamp keeps names unique across reboots
  const savedPath = `${await dataFolder(app, "images")}/${generateUUID()}-${item.changeCount}.png`;
  await tjs.copyFile(item.image, savedPath);
  return { ...item, image: savedPath };
}
