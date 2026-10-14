// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
const iconCache = new Map<string, string | null>();
const BUNDLE_ID_PATTERN = /^[\w.-]+$/;
// Folders searched when Spotlight can't find an app. Each is also searched one
// subfolder deep, to reach apps in Utilities/ or in vendor folders.
const APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`,
];
const textDecoder = new TextDecoder();
let installedApps: Promise<Map<string, string>> | undefined;

/** Run a command and return its trimmed output, or "" if it fails. */
async function runCommand(command: string[]): Promise<string> {
  const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += textDecoder.decode(value, { stream: true });
  }
  const exit = await child.wait();
  return exit.exit_status === 0 ? output.trim() : "";
}

async function findAppWithSpotlight(
  bundleId: string,
): Promise<string | undefined> {
  const results = await runCommand([
    "/usr/bin/mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`,
  ]);
  return results.split("\n").find((path) => path.endsWith(".app"));
}

async function readBundleId(appPath: string): Promise<string> {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`,
  ]);
}

/** Add every .app in folder (and up to `subfolderDepth` levels below) to apps. */
async function scanFolderForApps(
  folder: string,
  apps: Map<string, string>,
  subfolderDepth: number,
): Promise<void> {
  let entries: AsyncIterable<{ name: string; isDirectory: boolean }>;
  try {
    entries = await tjs.readDir(folder);
  } catch {
    return; // folder doesn't exist on this Mac (e.g. no ~/Applications)
  }
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (entry.name.endsWith(".app")) {
      const bundleId = await readBundleId(path);
      // first match wins, so /Applications beats copies found later
      if (bundleId && !apps.has(bundleId)) apps.set(bundleId, path);
    } else if (entry.isDirectory && subfolderDepth > 0) {
      await scanFolderForApps(path, apps, subfolderDepth - 1);
    }
  }
}

/** Bundle id → .app path for every app in APP_FOLDERS. Scanned once, on first
 *  use; the promise is cached so concurrent callers share a single scan. */
function getInstalledApps(): Promise<Map<string, string>> {
  installedApps ??= (async () => {
    const apps = new Map<string, string>();
    for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
    return apps;
  })();
  return installedApps;
}

// Spotlight first, folder scan as fallback: neither sends Apple Events, so no Automation prompt
async function findAppPath(bundleId: string): Promise<string> {
  // bundleId comes from the page and is interpolated into a Spotlight query, so validate it first
  if (typeof bundleId !== "string" || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error(`invalid bundle id: ${bundleId}`);
  }
  const appPath =
    (await findAppWithSpotlight(bundleId)) ??
    (await getInstalledApps()).get(bundleId);
  if (!appPath) throw new Error(`no app for ${bundleId}`);
  return appPath;
}

/** Quick Look thumbnail of path as a data: URL: a content preview where macOS
 *  has one, the file's icon otherwise. */
async function thumbnailUrl(
  path: string,
  size: number,
  app: TinyApp,
): Promise<string> {
  const thumbnail = await app.thumbnail(path, size);
  // thumbnails land in $TMPDIR, outside the webview's file:// sandbox, so send the png inline
  const png = await tjs.readFile(thumbnail.path);
  return `data:image/png;base64,${png.toBase64()}`;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}

export const api: Record<string, TinyApiHandler> = {
  async appIcon({ bundleId }, app) {
    if (iconCache.has(bundleId)) return iconCache.get(bundleId);
    let iconUrl: string | null = null;
    try {
      const appPath = await findAppPath(bundleId);
      iconUrl = await thumbnailUrl(appPath, 32, app);
    } catch (error) {
      // unknown bundle id or missing app: log it, then fall back to a generic icon
      // oxlint-disable-next-line no-console -- TinyApp has no logger; log() exists only page-side
      console.error(`appIcon failed for ${bundleId}:`, error);
    }
    iconCache.set(bundleId, iconUrl);
    return iconUrl;
  },

  // Not cached: files change and get deleted, and a Quick Look thumbnail takes milliseconds.
  // Resolves null when the file is gone (moved or deleted since it was copied).
  async filePreview({ path }, app) {
    if (typeof path !== "string" || !path.startsWith("/")) return null;
    if (!(await fileExists(path))) return null;
    try {
      return await thumbnailUrl(path, 64, app);
    } catch (error) {
      // file removed between the check and the thumbnail
      // oxlint-disable-next-line no-console -- TinyApp has no logger; log() exists only page-side
      console.error(`filePreview failed for ${path}:`, error);
      return null;
    }
  },
};

export function init(app: TinyApp) {
  app.tray.set({ icon: "sf:document.on.clipboard" });
  app.setHideOnClose(true);
}
