const settingsWindowId = "settings";

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

export async function openSettingsWindow(app: TinyApp): Promise<void> {
  app.window("main").hide({ app: false });
  // Show the Dock icon (the app icon, icon.png) while settings is open
  app.presence("normal");
  // Dev runs aren't a .app, so the new Dock tile shows a generic icon until
  // the project icon is re-applied. Only `tinyjs dev` sets TINYJS_ICON.
  if (tjs.env.TINYJS_ICON) app.icon(tjs.env.TINYJS_ICON);

  if (await isSettingsWindowOpen(app)) {
    app.window(settingsWindowId).show();
    return;
  }

  app.openWindow(settingsWindowId, {
    page: "settings.html",
    title: "Settings",
    size: "820x520",
    chrome: {
      frame: false,
      windowControls: true,
      transparent: true,
      vibrancy: "popover",
    },
  });
}

export function handleSettingsWindowClosed(
  windowId: string,
  app: TinyApp,
): void {
  if (windowId === settingsWindowId) app.presence("menubar");
}
