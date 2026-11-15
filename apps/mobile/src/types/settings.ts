export interface MobileSettings {
  /** Receive synced items in the background */
  backgroundReceive: boolean;
  /** Sync items that look like secrets */
  syncSecrets: boolean;
  /** Save what's on the clipboard when Teneo opens */
  captureOnOpen: boolean;
  /** Keep history for (days). 0 means forever */
  historyRetentionDays: number;
  /** Maximum number of history items to keep */
  maxItems: number;
  /** Mask secrets until revealed */
  hideSecrets: boolean;
  /** Look for a new version once a day, when the app opens */
  checkForUpdates: boolean;
}

export const defaultSettings: MobileSettings = {
  backgroundReceive: true,
  // as on the Mac: secrets stay on this phone until the user allows them
  syncSecrets: false,
  captureOnOpen: false,
  historyRetentionDays: 30,
  maxItems: 500,
  hideSecrets: true,
  checkForUpdates: true,
};
