// The setup window opens on every launch until the user finishes it
import { closeSetupWindow, openSetupWindow } from "./windows";

const setupCompleteStoreKey = "setupComplete";

export async function openSetupOnFirstLaunch(app: TinyApp): Promise<void> {
  if (await app.store.get(setupCompleteStoreKey)) return;
  openSetupWindow(app);
}

export async function finishSetup(app: TinyApp): Promise<void> {
  await app.store.set(setupCompleteStoreKey, true);
  await closeSetupWindow(app);
}
