// Until the user finishes the setup window, Teneo stays out of the menu bar:
// no icon, and no shortcut to open the panel
import config from "../tinyjs.json";
import { menuBarIcon } from "./app-identity";
import { devName } from "./dev-run";
import { syncOpenPanelShortcut } from "./global-shortcut";
import { appPaths } from "./paths";
import {
  closeSetupWindow,
  openSetupWindow,
  setupWindowId,
  showPanel,
} from "./windows";

// a dev run keeps its own, so it shows setup on its first launch
const setupCompleteStoreKey = () => devName("setupComplete");

async function isSetupComplete(app: TinyApp): Promise<boolean> {
  return Boolean(await app.store.get(setupCompleteStoreKey()));
}

async function showInMenuBar(app: TinyApp): Promise<void> {
  const { resources } = await appPaths(app);
  // Keep the variant's colours rather than using a monochrome template.
  const icon = menuBarIcon(config.id, Boolean(tjs.env.TINYJS_ICON));
  app.tray.set({
    icon: `${resources}/${icon}`,
    template: false,
    tooltip: config.title,
  });
  await syncOpenPanelShortcut(app);
}

export async function showMenuBarOrSetup(app: TinyApp): Promise<void> {
  if (await isSetupComplete(app)) await showInMenuBar(app);
  else await openSetupWindow(app);
}

export async function finishSetup(app: TinyApp): Promise<void> {
  // Setup reopened from Settings finds the menu bar icon already there
  const isInMenuBar = await isSetupComplete(app);
  await app.store.set(setupCompleteStoreKey(), true);
  await closeSetupWindow(app);
  if (!isInMenuBar) await showInMenuBar(app);
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
