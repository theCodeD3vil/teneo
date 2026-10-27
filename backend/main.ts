// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
import { pickSettings } from "../shared/types/settings";
import { getAppIconUrl } from "./app-icons";
import { readClipboardItem } from "./clipboard-history";
import { getDataFolderUsage } from "./data-usage";
import {
  encryptSecretsInHistory,
  initializeDatabase,
  keepEncryptionFromEarlierVersion,
  listClipboardItems,
  saveClipboardItem,
  setClipboardItemPinned,
  softDeleteClipboardItem,
  turnOffSecretEncryption,
  turnOnSecretEncryption,
} from "./database";
import { chooseAppToExclude, listExcludedApps } from "./excluded-apps";
import { getFilePreview } from "./file-previews";
import { logError } from "./files";
import { requestFolderAccess } from "./folder-access";
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
import {
  getLinkPreview,
  getLinkPreviewImage,
  removeStaleLinkPreviews,
} from "./link-previews";
import { getSettings, loadSettings, updateSettings } from "./settings";
import {
  finishSetup,
  quitIfSetupClosedEarly,
  showMenuBarOrSetup,
} from "./setup";
import {
  checkForUpdatesInBackground,
  installUpdate,
  startCheckingForUpdates,
} from "./updates";
import {
  closeUpdateWindow,
  getAvailableUpdate,
  handleWindowClosed,
  hidePanel,
  openSettingsWindow,
  openSetupWindow,
  openUpdateWindow,
} from "./windows";

export const api: Record<string, TinyApiHandler> = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  deleteClipboardItem: ({ id }, app) => softDeleteClipboardItem(id, app),
  pinClipboardItem: ({ id, pinned }, app) =>
    setClipboardItemPinned(id, pinned === true, app),
  chooseAppToExclude: (_parameters, app) => chooseAppToExclude(app),
  excludedApps: ({ addedBundleIds }, app) =>
    listExcludedApps(addedBundleIds, app),
  filePreview: ({ path, size }, app) => getFilePreview(path, size, app),
  requestFolderAccess: () => requestFolderAccess(),
  linkPreview: ({ url }, app) => getLinkPreview(url, app),
  linkPreviewImage: ({ url }, app) => getLinkPreviewImage(url, app),
  hidePanel: (_parameters, app) => hidePanel(app),
  openSettings: (_parameters, app) => openSettingsWindow(app),
  finishSetup: (_parameters, app) => finishSetup(app),
  openSetup: (_parameters, app) => openSetupWindow(app),
  openUpdate: (update, app) => openUpdateWindow(update, app),
  availableUpdate: () => getAvailableUpdate(),
  closeUpdate: (_parameters, app) => closeUpdateWindow(app),
  installUpdate: (_parameters, app) => installUpdate(app),
  pauseOpenPanelShortcut: ({ paused }, app) =>
    pauseOpenPanelShortcut(paused, app),
  settings: () => getSettings(),
  updateSettings: async (changes, app) => {
    const wasCheckingForUpdates = getSettings().checkForUpdates;
    // encryption moves saved keys too, so it only changes through setSecretEncryption
    const { encryptSecrets: _, ...otherChanges } = pickSettings(changes);
    const settings = await updateSettings(otherChanges, app);
    await syncOpenPanelShortcut(app);
    await trimClipboardHistory(app); // a tighter history limit applies now
    // turning update checks on looks now, not only at the next launch
    if (settings.checkForUpdates && !wasCheckingForUpdates) {
      void checkForUpdatesInBackground(app);
    }
    return settings;
  },
  setSecretEncryption: ({ enabled }, app) =>
    enabled === true
      ? turnOnSecretEncryption(app)
      : turnOffSecretEncryption(app),
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
  void pauseOpenPanelShortcut(false, app);
}

export async function init(app: TinyApp) {
  await loadSettings(app);
  await initializeDatabase(app);
  // not awaited: the menu bar icon shouldn't wait on a Keychain prompt
  await keepEncryptionFromEarlierVersion(app);
  if (getSettings().encryptSecrets) {
    void encryptSecretsInHistory(app).catch((error) =>
      logError("encrypting secrets in history failed:", error),
    );
  }
  startTrimmingClipboardHistory(app);
  void removeStaleLinkPreviews(app);
  app.setHideOnClose(true);
  // Open the panel on the current Space, over full-screen apps too
  app.setAllSpaces(true);
  // Stay above other apps' windows until hidden: closing takes a few IPC round
  // trips, and a normal-level panel drops behind the app that just took focus
  app.window("main").setLevel("floating");
  await showMenuBarOrSetup(app);
  // `TENEO_PREVIEW_SETUP=1 tinyjs dev` opens setup even when it's done
  if (tjs.env.TENEO_PREVIEW_SETUP) await openSetupWindow(app);
  startCheckingForUpdates(app);
  await previewUpdateWindow(app);
}

// Dev runs never find updates. `TENEO_PREVIEW_UPDATE=notes.md tinyjs dev`
// opens the update window with that file as the release notes.
async function previewUpdateWindow(app: TinyApp): Promise<void> {
  const notesPath = tjs.env.TENEO_PREVIEW_UPDATE;
  if (!notesPath) return;
  const notes = new TextDecoder().decode(await tjs.readFile(notesPath));
  await openUpdateWindow(
    { current: (await app.info()).version, latest: "9.9.9", notes },
    app,
  );
}
