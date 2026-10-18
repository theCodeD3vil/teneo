// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
import { getAppIconUrl } from "./app-icons";
import { readClipboardItem } from "./clipboard-history";
import {
  initializeDatabase,
  listClipboardItems,
  saveClipboardItem,
} from "./database";
import { chooseAppToExclude, listExcludedApps } from "./excluded-apps";
import { getFilePreview } from "./file-previews";
import { getSettings, loadSettings, updateSettings } from "./settings";
import {
  handleSettingsWindowClosed,
  hidePanel,
  openSettingsWindow,
} from "./windows";

export const api: Record<string, TinyApiHandler> = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  chooseAppToExclude: (_parameters, app) => chooseAppToExclude(app),
  excludedApps: (_parameters, app) => listExcludedApps(app),
  filePreview: ({ path }, app) => getFilePreview(path, app),
  hidePanel: (_parameters, app) => hidePanel(app),
  openSettings: (_parameters, app) => openSettingsWindow(app),
  settings: () => getSettings(),
  updateSettings: (changes, app) => updateSettings(changes, app),
};

// Defining this handler makes tinyjs start watching the clipboard.
export async function onClipboardChange(
  { self }: { changeCount: number; self: boolean },
  app: TinyApp,
) {
  if (self) return; // our own write, e.g. pasting a history item back
  const item = await readClipboardItem(app);
  if (item) await saveClipboardItem(item, app);
}

export function onWindowClosed(windowId: string, app: TinyApp) {
  handleSettingsWindowClosed(windowId, app);
}

export async function init(app: TinyApp) {
  await loadSettings(app);
  await initializeDatabase(app);
  app.tray.set({ icon: `${app.paths.resources}/tray.png` });
  app.setHideOnClose(true);
}
