// The system-wide shortcut that opens the panel. The panel window toggles
// itself when the press arrives (App.vue); this only keeps the registration
// in step with the setting.
import { openPanelHotkeyId } from "../shared/types/settings";
import { getSettings } from "./settings";

// Same characters the settings page produces, e.g. "ctrl+opt+v"
const SHORTCUT_PATTERN = /^[a-z0-9+]+$/;
let registeredShortcut = "";
// While the user records a new shortcut, the old one is released so its
// keys reach the recorder instead of opening the panel
let isPaused = false;

/** Register the current shortcut, replacing whatever was registered before. */
export function syncOpenPanelShortcut(app: TinyApp): void {
  const shortcut = isPaused ? "" : getSettings().openPanelShortcut;
  const validShortcut = SHORTCUT_PATTERN.test(shortcut) ? shortcut : "";
  if (validShortcut === registeredShortcut) return;

  if (registeredShortcut) app.hotkey.unregister(openPanelHotkeyId);
  if (validShortcut) app.hotkey.register(openPanelHotkeyId, validShortcut);
  registeredShortcut = validShortcut;
}

export function pauseOpenPanelShortcut(paused: unknown, app: TinyApp): void {
  isPaused = paused === true;
  syncOpenPanelShortcut(app);
}
