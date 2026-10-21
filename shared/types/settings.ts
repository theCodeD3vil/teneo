/** User settings, owned by the backend and mirrored in every window. */
export interface AppSettings {
  /** look for a new version each time Teneo starts */
  checkForUpdates: boolean;
  /** Enter pastes into the active app instead of only copying */
  pasteOnEnter: boolean;
  /** skip copies from password managers and the apps in excludedApps */
  ignorePasswords: boolean;
  /** show API keys and other secrets in history as asterisks; pasting still
   *  gives the real text */
  maskSecrets: boolean;
  /** save text holding a secret encrypted, with the key in the Keychain.
   *  Changed only through the setSecretEncryption api, which also encrypts
   *  or decrypts what's already saved */
  encryptSecrets: boolean;
  /** show a copied link's site icon, fetched from the site itself */
  showLinkPreviews: boolean;
  /** bundle ids of apps the user added to the ignore list; known password
   *  managers are built in and never stored here */
  excludedApps: string[];
  /** global shortcut that opens the panel, as a tinyjs combo such as
   *  "ctrl+opt+v"; "" = none */
  openPanelShortcut: string;
  /** history items older than this are deleted */
  historyDuration: HistoryDuration;
  /** most items kept, the oldest deleted first; 0 = no limit */
  maximumItems: number;
  /** most bytes clipboard history may take, the oldest deleted first;
   *  0 = no limit */
  maximumStorage: number;
}

export type HistoryDuration = "day" | "week" | "month" | "year" | "forever";

export const defaultSettings: AppSettings = {
  checkForUpdates: true,
  pasteOnEnter: false,
  ignorePasswords: true,
  maskSecrets: true,
  encryptSecrets: false,
  showLinkPreviews: true,
  excludedApps: [],
  openPanelShortcut: "",
  historyDuration: "forever",
  maximumItems: 0,
  maximumStorage: 0,
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
