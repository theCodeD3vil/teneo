// Turns a clipboard change into a history item. Anything that only exists for a
// moment (the image's temp file, the source app) is saved to the data dir now.
import { saveAppIcon } from "./app-icons";
import { normalizeClipboardColor } from "./color";
import { isExcludedApp } from "./excluded-apps";
import { dataFolder, logError } from "./files";
import { appPaths } from "./paths";
import { getSettings } from "./settings";
import type { ClipboardItemToSave } from "./types/clipboard";
import { generateUUID } from "./utils/uuid-generator";

const imageFilePattern = /\.(png|jpe?g|gif|heic|webp|tiff?|bmp)$/i;

function isFromPasswordManager(item: TinyClipboardData): boolean {
  // concealed = the org.nspasteboard marker well-behaved password managers set
  if (item.concealed) return true;
  const bundleId = item.sourceApp?.bundleId;
  return bundleId != null && isExcludedApp(bundleId);
}

/** Read the clipboard as a history item, or null for items history must skip. */
export async function readClipboardItem(
  app: TinyApp,
): Promise<ClipboardItemToSave | null> {
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
  const { temp } = await appPaths(app);
  return saveClipboardImage(
    tempImageFileAsImage(normalizeClipboardColor(item), temp),
    app,
  );
}

/** Screenshot tools such as BetterShot copy an image file in the temp folder
 *  along with the picture itself. History keeps it as an image, since macOS
 *  clears the temp folder, but pastes it back as a file, like the tool does.
 *  sourceApp stays the app in front, usually the one in the screenshot. */
function tempImageFileAsImage(
  item: TinyClipboardData,
  tempFolder: string,
): ClipboardItemToSave {
  const [path] = item.paths;
  const isTempImageFile =
    item.kind === "files" &&
    item.paths.length === 1 &&
    item.image !== null && // the picture is on the clipboard too
    imageFilePattern.test(path) &&
    isInTempFolder(path, tempFolder);
  if (!isTempImageFile) return item;

  // image points at the tool's file, so the real file is what gets saved
  return { ...item, kind: "image", image: path, paths: [], pasteAsFile: true };
}

function isInTempFolder(path: string, tempFolder: string): boolean {
  const folder = tempFolder.replace(/\/$/, "");
  // /var is a symlink to /private/var, so a path can use either form
  return path.startsWith(`${folder}/`) || path.startsWith(`/private${folder}/`);
}

/** Copy a clipboard image out of its temp file, which is replaced on the next
 *  copy. Returns the item pointing at the saved copy. */
async function saveClipboardImage(
  item: ClipboardItemToSave,
  app: TinyApp,
): Promise<ClipboardItemToSave> {
  if (item.kind !== "image" || !item.image) return item;
  // A file pasted back keeps its name and type; the UUID keeps names unique
  const fileName = item.pasteAsFile
    ? item.image.split("/").pop()
    : `${item.changeCount}.png`;
  const savedPath = `${await dataFolder(app, "images")}/${generateUUID()}-${fileName}`;
  await tjs.copyFile(item.image, savedPath);
  return { ...item, image: savedPath };
}
