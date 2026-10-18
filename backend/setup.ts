// Until the user finishes the setup window, Teneo stays out of the menu bar:
// no icon, and no shortcut to open the panel
import { syncOpenPanelShortcut } from "./global-shortcut";
import {
  closeSetupWindow,
  openSetupWindow,
  setupWindowId,
  showPanel,
} from "./windows";

const setupCompleteStoreKey = "setupComplete";

async function isSetupComplete(app: TinyApp): Promise<boolean> {
  return Boolean(await app.store.get(setupCompleteStoreKey));
}

function showInMenuBar(app: TinyApp): void {
  app.tray.set({ icon: `${app.paths.resources}/tray.png` });
  syncOpenPanelShortcut(app);
}

export async function showMenuBarOrSetup(app: TinyApp): Promise<void> {
  if (await isSetupComplete(app)) showInMenuBar(app);
  else await openSetupWindow(app);
}

export async function finishSetup(app: TinyApp): Promise<void> {
  // Setup reopened from Settings finds the menu bar icon already there
  const isInMenuBar = await isSetupComplete(app);
  await app.store.set(setupCompleteStoreKey, true);
  await closeSetupWindow(app);
  if (!isInMenuBar) showInMenuBar(app);
  await showPanel(app);
}

// With no menu bar icon yet, Teneo would keep running out of sight, so
// closing setup early quits. The next launch opens setup again.
export async function quitIfSetupClosedEarly(
  windowId: string,
  app: TinyApp,
): Promise<void> {
  if (windowId === setupWindowId && !(await isSetupComplete(app))) app.quit();
}
