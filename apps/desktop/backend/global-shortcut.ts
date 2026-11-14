// The system-wide shortcut that opens the panel. The panel window toggles
// itself when the press arrives (App.vue); this only keeps the registration
// in step with the setting.
import { openPanelHotkeyId } from "../shared/types/settings";
import { logError } from "./files";
import { getSettings } from "./settings";

// Same characters the settings page produces, e.g. "ctrl+opt+v"
const SHORTCUT_PATTERN = /^[a-z0-9+]+$/;
let registeredShortcut = "";
// While the user records a new shortcut, the old one is released so its
// keys reach the recorder instead of opening the panel
let isPaused = false;

// register() is async, so calls run one after another; a second one would
// otherwise read the state before the first has finished changing it
let pending: Promise<void> = Promise.resolve();

/** Register the current shortcut, replacing whatever was registered before. */
export function syncOpenPanelShortcut(app: TinyApp): Promise<void> {
  pending = pending.then(() => applyShortcut(app));
  return pending;
}

async function applyShortcut(app: TinyApp): Promise<void> {
  const shortcut = isPaused ? "" : getSettings().openPanelShortcut;
  const validShortcut = SHORTCUT_PATTERN.test(shortcut) ? shortcut : "";
  if (validShortcut === registeredShortcut) return;

  try {
    if (registeredShortcut) app.hotkey.unregister(openPanelHotkeyId);
    registeredShortcut = "";
    if (!validShortcut) return;
    // false: the combo isn't valid or another app holds it. Left unregistered,
    // so the next sync tries again.
    if (await app.hotkey.register(openPanelHotkeyId, validShortcut)) {
      registeredShortcut = validShortcut;
    } else {
      logError("the open-panel shortcut wasn't registered:", validShortcut);
    }
  } catch (error) {
    logError("registering the open-panel shortcut failed:", error);
  }
}

export function pauseOpenPanelShortcut(
  paused: unknown,
  app: TinyApp,
): Promise<void> {
  isPaused = paused === true;
  return syncOpenPanelShortcut(app);
}
