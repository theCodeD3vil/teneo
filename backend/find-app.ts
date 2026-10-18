// Find an installed app's .app folder from its bundle id. Spotlight first, a
// folder scan as fallback: neither sends Apple Events, so no Automation prompt.
import { fileExists } from "./files";
import { runCommand } from "./run-command";

// Folders scanned when Spotlight can't find an app. Each is also scanned one
// subfolder deep, to reach apps in Utilities/ or in vendor folders.
const APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`,
];
// bundle ids go into a Spotlight query and file names, so only bundle-id characters pass
const BUNDLE_ID_PATTERN = /^[\w.-]+$/;
let installedApps: Promise<Map<string, string>> | undefined;

export function isValidBundleId(bundleId: string): boolean {
  return BUNDLE_ID_PATTERN.test(bundleId);
}

/** The .app path for bundleId, or undefined if it isn't installed.
 *  bundleId must already be validated: it goes into a Spotlight query. */
export async function findAppPath(
  bundleId: string,
): Promise<string | undefined> {
  return (
    (await findAppWithSpotlight(bundleId)) ??
    (await getInstalledApps()).get(bundleId)
  );
}

async function findAppWithSpotlight(
  bundleId: string,
): Promise<string | undefined> {
  const results = await runCommand([
    "/usr/bin/mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`,
  ]);
  const appPath = results.split("\n").find((path) => path.endsWith(".app"));
  // a stale index can still list an app that was moved or deleted; undefined lets the folder scan run
  return appPath && (await fileExists(appPath)) ? appPath : undefined;
}

/** Bundle id → .app path for every app in APP_FOLDERS. Scanned once, on first
 *  use; the promise is kept so concurrent callers share a single scan. */
function getInstalledApps(): Promise<Map<string, string>> {
  installedApps ??= scanAllFolders().catch((error) => {
    installedApps = undefined; // don't keep a failed scan; the next call retries
    throw error;
  });
  return installedApps;
}

async function scanAllFolders(): Promise<Map<string, string>> {
  const apps = new Map<string, string>();
  for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
  return apps;
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

/** The app's bundle id from its Info.plist, or "" if it can't be read. */
export function readBundleId(appPath: string): Promise<string> {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`,
  ]);
}
