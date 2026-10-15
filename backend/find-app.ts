// Find an installed app's .app folder from its bundle id. Spotlight first, a
// folder scan as fallback: neither sends Apple Events, so no Automation prompt.
import { runCommand } from "./run-command";

// Folders scanned when Spotlight can't find an app. Each is also scanned one
// subfolder deep, to reach apps in Utilities/ or in vendor folders.
const APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`,
];
let installedApps: Promise<Map<string, string>> | undefined;

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
  return results.split("\n").find((path) => path.endsWith(".app"));
}

/** Bundle id → .app path for every app in APP_FOLDERS. Scanned once, on first
 *  use; the promise is kept so concurrent callers share a single scan. */
function getInstalledApps(): Promise<Map<string, string>> {
  installedApps ??= (async () => {
    const apps = new Map<string, string>();
    for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
    return apps;
  })();
  return installedApps;
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

function readBundleId(appPath: string): Promise<string> {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`,
  ]);
}
