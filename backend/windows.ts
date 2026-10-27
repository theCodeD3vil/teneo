import { showPanelEvent } from "../shared/types/windows";

const settingsWindowId = "settings";
export const setupWindowId = "setup";
export const updateWindowId = "update";
// Windows hidePanel keeps on screen when it hides the app
const appWindowIds = [settingsWindowId, setupWindowId];

// Same frame and material as the panel
const windowChrome: TinyChromeOptions = {
  frame: false,
  windowControls: true,
  transparent: true,
  vibrancy: "sheet",
};

async function isWindowOpen(app: TinyApp, windowId: string): Promise<boolean> {
  return (await app.windows()).includes(windowId);
}

async function isWindowOnScreen(
  app: TinyApp,
  windowId: string,
): Promise<boolean> {
  if (!(await isWindowOpen(app, windowId))) return false;
  const state = await app.window(windowId).getState();
  return Boolean(state?.visible && !state.minimized);
}

async function waitForFocusToLeave(
  app: TinyApp,
  teneoProcessId: number | undefined,
): Promise<void> {
  // The hand-off usually takes under 60ms; don't hold up a paste if it never comes
  // performance.now() only moves forward, unlike Date.now(), which follows the
  // Mac's clock: a clock set back mid-wait would stretch 500ms into hours
  const deadline = performance.now() + 500;
  while (
    performance.now() < deadline &&
    (await app.frontmostApp())?.pid === teneoProcessId
  ) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/**
 * Put the panel away, leaving the settings and setup windows on screen.
 */
export async function hidePanel(app: TinyApp): Promise<void> {
  const panel = app.window("main");
  panel.hide({ app: false });
  // The panel never activates Teneo, so the app the user came from keeps focus.
  // Only when Teneo was already active (settings or setup in front) does focus
  // need handing back.
  if ((await app.frontmostApp())?.pid !== tjs.pid) return;

  const isOnScreen = await Promise.all(
    appWindowIds.map((windowId) => isWindowOnScreen(app, windowId)),
  );
  const windowIdsToKeep = appWindowIds.filter((_, index) => isOnScreen[index]);
  // A bare hide() on main hides the whole app: macOS refocuses the previous app
  panel.hide();
  if (!windowIdsToKeep.length) return;

  // Showing them before that hand-off finishes keeps focus in Teneo
  await waitForFocusToLeave(app, tjs.pid);
  for (const windowId of windowIdsToKeep) {
    app.window(windowId).show({ activate: false });
  }
}

// Show the Dock icon (the app icon, icon.png). Only setup gets one: in Dock mode
// the panel opens on Teneo's own Space instead of over a full-screen app, and
// Settings can stay open in the background for a long time.
function showInDock(app: TinyApp): void {
  app.presence("normal");
  // Dev runs aren't a .app, so the new Dock tile shows a generic icon until
  // the project icon is re-applied. Only `tinyjs dev` sets TINYJS_ICON.
  if (tjs.env.TINYJS_ICON) app.icon(tjs.env.TINYJS_ICON);
}

export async function openSettingsWindow(app: TinyApp): Promise<void> {
  app.window("main").hide({ app: false });
  if (!(await isWindowOpen(app, settingsWindowId))) {
    app.win.open(settingsWindowId, {
      page: "settings.html",
      title: "Settings",
      size: "820x640",
      chrome: windowChrome,
    });
  }
  // Without a Dock icon Teneo doesn't come to the front by itself
  app.window(settingsWindowId).show();
}

// Opens at first launch, and again from the banner in Settings
export async function openSetupWindow(app: TinyApp): Promise<void> {
  showInDock(app);
  if (!(await isWindowOpen(app, setupWindowId))) {
    app.win.open(setupWindowId, {
      page: "setup.html",
      title: "Welcome to Teneo",
      size: "560x560",
      chrome: windowChrome,
    });
  }
  // An app launched without a Dock icon doesn't come to the front by itself
  app.window(setupWindowId).show();
}

let availableUpdate: TinyUpdateInfo | null = null;

// The page reads this once it loads
export function getAvailableUpdate(): TinyUpdateInfo | null {
  return availableUpdate;
}

/** Ask to install an update, in Teneo's own window rather than a native alert. */
export async function openUpdateWindow(
  update: TinyUpdateInfo,
  app: TinyApp,
): Promise<void> {
  availableUpdate = update;
  if (!(await isWindowOpen(app, updateWindowId))) {
    app.win.open(updateWindowId, {
      page: "update.html",
      title: `Teneo ${update.latest} is available`,
      size: "480x720",
      chrome: { ...windowChrome, windowControls: false },
    });
    // Like an alert: above other apps, and on any Space or full-screen app
    app.window(updateWindowId).setLevel("floating");
    app.window(updateWindowId).setAllSpaces(true);
  }
  app.window(updateWindowId).show();
}

export async function closeUpdateWindow(app: TinyApp): Promise<void> {
  app.window(updateWindowId).close();
  const isOnScreen = await Promise.all(
    appWindowIds.map((windowId) => isWindowOnScreen(app, windowId)),
  );
  // Focus moves to Settings or setup by itself; otherwise hand it back to
  // the app the user was in. A bare hide() on main hides the whole app.
  if (!isOnScreen.includes(true)) app.window("main").hide();
}

export async function closeSetupWindow(app: TinyApp): Promise<void> {
  // The setup window has focus, so the frontmost app is Teneo
  const teneoProcessId = (await app.frontmostApp())?.pid;
  app.window(setupWindowId).close();
  // Leaving the Dock makes macOS hand focus to another app a moment later. A
  // panel shown before that loses focus and hides itself, so wait it out.
  app.presence("menubar");
  await waitForFocusToLeave(app, teneoProcessId);
}

type TrayRect = Awaited<ReturnType<TinyApp["tray"]["position"]>>;

function isSameRect(rect: TrayRect, other: TrayRect): boolean {
  return (
    rect?.x === other?.x &&
    rect?.y === other?.y &&
    rect?.width === other?.width &&
    rect?.height === other?.height
  );
}

/** Wait for a menu bar icon added a moment ago to take its place. */
async function waitForTrayToSettle(app: TinyApp): Promise<boolean> {
  // A new icon first reports a zero-height placeholder at the bottom of the
  // screen, then slides up into the menu bar (~350ms)
  // performance.now(), not Date.now(): a change to the Mac's clock mustn't
  // shorten or stretch the wait (see waitForFocusToLeave)
  const deadline = performance.now() + 2000;
  let previousRect: TrayRect = null;
  while (performance.now() < deadline) {
    const rect = await app.tray.position();
    if (rect && rect.height > 0 && isSameRect(rect, previousRect)) return true;
    previousRect = rect;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Open the panel under the menu bar icon. */
export async function showPanel(app: TinyApp): Promise<void> {
  // Without the icon's real position the panel would open in a screen
  // corner; the user can still click the icon
  if (!(await waitForTrayToSettle(app))) return;
  // The panel positions itself under the icon, so it opens itself
  app.window("main").push(showPanelEvent);
}

export async function handleWindowClosed(
  windowId: string,
  app: TinyApp,
): Promise<void> {
  if (windowId === setupWindowId) app.presence("menubar");
  if (windowId !== settingsWindowId) return;

  // Settings has no Dock icon to leave, so nothing hands focus back by itself
  const isOnScreen = await Promise.all(
    [...appWindowIds, updateWindowId].map((id) => isWindowOnScreen(app, id)),
  );
  if (isOnScreen.includes(true)) return;
  // A bare hide() on main hides the whole app: macOS refocuses the previous app
  if ((await app.frontmostApp())?.pid === tjs.pid) app.window("main").hide();
}
