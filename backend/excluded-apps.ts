// Apps whose copies are kept out of clipboard history while "Ignore password
// managers" is on: known password managers, plus apps the user adds.
import type { ExcludedApp } from "../shared/types/settings";
import { getAppIconUrl } from "./app-icons";
import { findAppPath, isValidBundleId, readBundleId } from "./find-app";
import { runCommand } from "./run-command";
import { getSettings, updateSettings } from "./settings";

// Matched by source app because some copy plain text without the concealed
// marker (Proton Pass is an Electron app)
const passwordManagerBundleIds = [
  "me.proton.pass.electron", // Proton Pass
  "com.apple.Passwords",
  "com.apple.keychainaccess",
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.bitwarden.desktop",
  "org.keepassxc.keepassxc",
];

export function isExcludedApp(bundleId: string): boolean {
  return (
    passwordManagerBundleIds.includes(bundleId) ||
    getSettings().excludedApps.includes(bundleId)
  );
}

/** Built-in password managers installed on this Mac, plus every app the user
 *  added (even if it has since been uninstalled, so it can still be removed). */
export async function listExcludedApps(app: TinyApp): Promise<ExcludedApp[]> {
  const addedBundleIds = getSettings().excludedApps.filter(isValidBundleId);
  const candidates = [
    ...passwordManagerBundleIds.map((bundleId) => ({
      bundleId,
      addedByUser: false,
    })),
    ...addedBundleIds.map((bundleId) => ({ bundleId, addedByUser: true })),
  ];

  const excludedApps = await Promise.all(
    candidates.map(async ({ bundleId, addedByUser }) => {
      const appPath = await findAppPath(bundleId);
      if (!appPath && !addedByUser) return null;
      return {
        bundleId,
        addedByUser,
        name: appPath ? getAppName(appPath) : bundleId,
        iconUrl: await getAppIconUrl(bundleId, app),
      };
    }),
  );
  return excludedApps.filter((excludedApp) => excludedApp !== null);
}

// tinyjs's file dialog can't pick its starting folder, so this uses
// AppleScript's, which can. `activate` brings the dialog to the front.
const chooseAppScript = [
  "activate",
  'POSIX path of (choose file with prompt "Choose an app to ignore" of type {"com.apple.application-bundle"} default location (path to applications folder))',
];

/** Ask the user for an app, starting in /Applications, and ignore it. */
export async function chooseAppToExclude(app: TinyApp): Promise<void> {
  const appPath = await runCommand([
    "/usr/bin/osascript",
    ...chooseAppScript.flatMap((line) => ["-e", line]),
  ]);
  // "" = the user cancelled
  if (appPath) await excludeApp(appPath, app);
}

/** Add the app at appPath to the ignore list. */
async function excludeApp(appPath: string, app: TinyApp): Promise<void> {
  // AppleScript ends a package's path with "/"
  appPath = appPath.replace(/\/$/, "");
  if (!appPath.endsWith(".app")) throw new Error("Choose an app to ignore");
  const bundleId = await readBundleId(appPath);
  if (!isValidBundleId(bundleId)) {
    throw new Error(`Couldn't read the app id of ${getAppName(appPath)}`);
  }
  if (isExcludedApp(bundleId)) return;
  await updateSettings(
    { excludedApps: [...getSettings().excludedApps, bundleId] },
    app,
  );
}

/** "/Applications/Proton Pass.app" → "Proton Pass", as Finder shows it. */
function getAppName(appPath: string): string {
  return (appPath.split("/").pop() ?? appPath).replace(/\.app$/, "");
}
