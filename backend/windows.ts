import { showPanelEvent } from "../shared/types/windows";

const settingsWindowId = "settings";
const setupWindowId = "setup";
// Teneo shows a Dock icon while either of these is open
const dockWindowIds = [settingsWindowId, setupWindowId];

// Same frame and material as the panel
const windowChrome: TinyChromeOptions = {
  frame: false,
  windowControls: true,
  transparent: true,
  vibrancy: "popover",
};

async function isSettingsWindowOpen(app: TinyApp): Promise<boolean> {
  return (await app.windows()).includes(settingsWindowId);
}

async function isSettingsWindowOnScreen(app: TinyApp): Promise<boolean> {
  if (!(await isSettingsWindowOpen(app))) return false;
  const state = await app.window(settingsWindowId).getState();
  return Boolean(state?.visible && !state.minimized);
}

async function waitForFocusToLeave(
  app: TinyApp,
  teneoProcessId: number | undefined,
): Promise<void> {
  // The hand-off usually takes under 60ms; don't hold up a paste if it never comes
  const deadline = Date.now() + 500;
  while (
    Date.now() < deadline &&
    (await app.frontmostApp())?.pid === teneoProcessId
  ) {
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/**
 * Put the panel away and hand focus back to the app the user came from,
 * leaving the settings window on screen.
 */
export async function hidePanel(app: TinyApp): Promise<void> {
  const panel = app.window("main");
  const keepSettingsOnScreen = await isSettingsWindowOnScreen(app);
  // The panel has focus, so the frontmost app is Teneo
  const teneoProcessId = keepSettingsOnScreen
    ? (await app.frontmostApp())?.pid
    : undefined;

  // Panel first, so unhiding the app below can't bring it back
  panel.hide({ app: false });
  // A bare hide() on main hides the whole app: macOS refocuses the previous app
  panel.hide();
  if (!keepSettingsOnScreen) return;

  // Showing settings before that hand-off finishes keeps focus in Teneo
  await waitForFocusToLeave(app, teneoProcessId);
  app.window(settingsWindowId).show({ activate: false });
}

// Show the Dock icon (the app icon, icon.png)
function showInDock(app: TinyApp): void {
  app.presence("normal");
  // Dev runs aren't a .app, so the new Dock tile shows a generic icon until
  // the project icon is re-applied. Only `tinyjs dev` sets TINYJS_ICON.
  if (tjs.env.TINYJS_ICON) app.icon(tjs.env.TINYJS_ICON);
}

async function leaveDockUnlessWindowOpen(
  app: TinyApp,
  closedWindowId: string,
): Promise<void> {
  const openWindowIds = await app.windows();
  const isOtherWindowOpen = dockWindowIds.some(
    (windowId) =>
      windowId !== closedWindowId && openWindowIds.includes(windowId),
  );
  if (!isOtherWindowOpen) app.presence("menubar");
}

export async function openSettingsWindow(app: TinyApp): Promise<void> {
  app.window("main").hide({ app: false });
  showInDock(app);

  if (await isSettingsWindowOpen(app)) {
    app.window(settingsWindowId).show();
    return;
  }

  app.openWindow(settingsWindowId, {
    page: "settings.html",
    title: "Settings",
    size: "820x520",
    chrome: windowChrome,
  });
}

export function openSetupWindow(app: TinyApp): void {
  showInDock(app);
  app.openWindow(setupWindowId, {
    page: "setup.html",
    title: "Welcome to Teneo",
    size: "560x560",
    chrome: windowChrome,
  });
  // An app launched without a Dock icon doesn't come to the front by itself
  app.window(setupWindowId).show();
}

/** Close the setup window, then open the panel under the menu bar icon. */
export async function closeSetupWindow(app: TinyApp): Promise<void> {
  app.window(setupWindowId).close();
  // Leave the Dock before the panel shows, so the switch can't take its focus
  await leaveDockUnlessWindowOpen(app, setupWindowId);
  // The panel positions itself under the tray icon, so it opens itself
  app.window("main").push(showPanelEvent);
}

export async function handleWindowClosed(
  windowId: string,
  app: TinyApp,
): Promise<void> {
  if (dockWindowIds.includes(windowId)) {
    await leaveDockUnlessWindowOpen(app, windowId);
  }
}
