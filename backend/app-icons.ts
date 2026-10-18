// Source-app icons. Each icon is saved to the data dir the first time its app is
// seen, so history keeps showing it even after the app is uninstalled.
import { dataFolder, fileExists, logError, pngDataUrl } from "./files";
import { findAppPath, isValidBundleId } from "./find-app";

const ICON_SIZE = 32;
// one promise per app, so cards asking for the same icon at once share one lookup
const iconUrls = new Map<string, Promise<string | null>>();

/** Save the app's icon once and return the saved png, or null if the app isn't installed. */
export async function saveAppIcon(
  bundleId: string,
  app: TinyApp,
): Promise<string | null> {
  if (!isValidBundleId(bundleId)) return null;
  const iconPath = `${await dataFolder(app, "icons")}/${bundleId}.png`;
  if (await fileExists(iconPath)) return iconPath;
  const appPath = await findAppPath(bundleId);
  if (!appPath) return null;
  const thumbnail = await app.thumbnail(appPath, ICON_SIZE);
  await tjs.copyFile(thumbnail.path, iconPath);
  return iconPath;
}

/** The app's icon as a data: URL, or null so the card shows no icon. */
export function getAppIconUrl(
  bundleId: unknown,
  app: TinyApp,
): Promise<string | null> {
  if (typeof bundleId !== "string") return Promise.resolve(null);
  let iconUrl = iconUrls.get(bundleId);
  if (!iconUrl) {
    iconUrl = loadAppIconUrl(bundleId, app);
    iconUrls.set(bundleId, iconUrl);
  }
  return iconUrl;
}

async function loadAppIconUrl(
  bundleId: string,
  app: TinyApp,
): Promise<string | null> {
  try {
    const iconPath = await saveAppIcon(bundleId, app);
    return iconPath ? await pngDataUrl(iconPath) : null;
  } catch (error) {
    logError(`appIcon failed for ${bundleId}:`, error);
    return null;
  }
}
