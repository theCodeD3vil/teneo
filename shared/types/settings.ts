/** User settings, owned by the backend and mirrored in every window. */
export interface AppSettings {
  /** Enter pastes into the active app instead of only copying */
  pasteOnEnter: boolean;
  /** skip copies from password managers and the apps in excludedApps */
  ignorePasswords: boolean;
  /** bundle ids of apps the user added to the ignore list; known password
   *  managers are built in and never stored here */
  excludedApps: string[];
  /** global shortcut that opens the panel, as a tinyjs combo such as
   *  "ctrl+opt+v"; "" = none */
  openPanelShortcut: string;
}

export const defaultSettings: AppSettings = {
  pasteOnEnter: false,
  ignorePasswords: true,
  excludedApps: [],
  openPanelShortcut: "",
};

/** tinyjs hotkey id of the open-panel shortcut; presses arrive as a
 *  "hotkey" event carrying this id */
export const openPanelHotkeyId = "open-panel";

/** An app whose copies are kept out of clipboard history. */
export interface ExcludedApp {
  bundleId: string;
  name: string;
  /** data: URL of the app's icon, or null when it can't be found */
  iconUrl: string | null;
  /** false for the built-in password managers, which can't be removed */
  addedByUser: boolean;
}

/** Backend event pushed to every window with the full settings after a change. */
export const settingsChangedEvent = "settings-changed";

/** Keep only known settings with the right type, e.g. from the store or a page. */
export function pickSettings(value: unknown): Partial<AppSettings> {
  if (typeof value !== "object" || value === null) return {};
  const settings: Record<string, unknown> = {};
  for (const key of Object.keys(defaultSettings) as Array<keyof AppSettings>) {
    const setting = (value as Record<string, unknown>)[key];
    const defaultSetting = defaultSettings[key];
    const isValid = Array.isArray(defaultSetting)
      ? Array.isArray(setting) &&
        setting.every((entry) => typeof entry === "string")
      : typeof setting === typeof defaultSetting;
    if (isValid) settings[key] = setting;
  }
  return settings as Partial<AppSettings>;
}
