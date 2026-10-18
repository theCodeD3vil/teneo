// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
import { getAppIconUrl } from "./app-icons";
import { readClipboardItem } from "./clipboard-history";
import { getDataFolderUsage } from "./data-usage";
import {
  initializeDatabase,
  listClipboardItems,
  saveClipboardItem,
} from "./database";
import { chooseAppToExclude, listExcludedApps } from "./excluded-apps";
import { getFilePreview } from "./file-previews";
import {
  pauseOpenPanelShortcut,
  syncOpenPanelShortcut,
} from "./global-shortcut";
import {
  clearClipboardHistory,
  countItemsDeletedBy,
  startTrimmingClipboardHistory,
  trimClipboardHistory,
} from "./history-limits";
import { getSettings, loadSettings, updateSettings } from "./settings";
import {
  finishSetup,
  quitIfSetupClosedEarly,
  showMenuBarOrSetup,
} from "./setup";
import {
  handleWindowClosed,
  hidePanel,
  openSettingsWindow,
  openSetupWindow,
} from "./windows";

export const api: Record<string, TinyApiHandler> = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  chooseAppToExclude: (_parameters, app) => chooseAppToExclude(app),
  excludedApps: ({ addedBundleIds }, app) =>
    listExcludedApps(addedBundleIds, app),
  filePreview: ({ path }, app) => getFilePreview(path, app),
  hidePanel: (_parameters, app) => hidePanel(app),
  openSettings: (_parameters, app) => openSettingsWindow(app),
  finishSetup: (_parameters, app) => finishSetup(app),
  openSetup: (_parameters, app) => openSetupWindow(app),
  pauseOpenPanelShortcut: ({ paused }, app) =>
    pauseOpenPanelShortcut(paused, app),
  settings: () => getSettings(),
  updateSettings: async (changes, app) => {
    const settings = await updateSettings(changes, app);
    syncOpenPanelShortcut(app);
    await trimClipboardHistory(app); // a tighter history limit applies now
    return settings;
  },
  clearHistory: (_parameters, app) => clearClipboardHistory(app),
  countItemsDeletedBy: ({ changes }, app) => countItemsDeletedBy(changes, app),
  dataFolderUsage: (_parameters, app) => getDataFolderUsage(app),
};

// Defining this handler makes tinyjs start watching the clipboard.
export async function onClipboardChange(
  { self }: { changeCount: number; self: boolean },
  app: TinyApp,
) {
  if (self) return; // our own write, e.g. pasting a history item back
  const item = await readClipboardItem(app);
  if (!item) return;
  await saveClipboardItem(item, app);
  await trimClipboardHistory(app); // keeps "Maximum items" as copies come in
}

export function onWindowClosed(windowId: string, app: TinyApp) {
  void handleWindowClosed(windowId, app);
  void quitIfSetupClosedEarly(windowId, app);
  // settings may close mid-recording; bring the shortcut back
  pauseOpenPanelShortcut(false, app);
}

export async function init(app: TinyApp) {
  await loadSettings(app);
  await initializeDatabase(app);
  startTrimmingClipboardHistory(app);
  app.setHideOnClose(true);
  // Open the panel on the current Space, over full-screen apps too
  app.setAllSpaces(true);
  await showMenuBarOrSetup(app);
}
