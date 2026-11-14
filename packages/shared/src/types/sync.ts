/** A device this one syncs with. */
export interface SyncDevice {
  deviceId: string;
  name: string;
  /** "mac", "android", ... as the device reported it */
  platform: string;
  connected: boolean;
  /** when it was last connected, in ms since the epoch */
  lastSeenAt: number;
}

/** How sync is going on this device, as the Sync tab shows it. */
export interface SyncStatus {
  /** Whether this build has sync switched on at all. The Sync tab only shows
   *  then. */
  available: boolean;
  /** This device has a vault key and means to sync. */
  enabled: boolean;
  /** The sync engine is running now. */
  running: boolean;
  /** Something sync can't do, in words for the user; null when all is well. */
  problem: string | null;
  /** How this device is named on the others. */
  deviceName: string;
  /** Devices paired with this one, connected or not. */
  devices: SyncDevice[];
}

/** What a new device needs to join this one. Both unlock the whole history:
 *  show them only when the user asks. */
export interface PairingInfo {
  /** the vault key for typing in, in groups of four */
  recoveryCode: string;
  /** what the QR code holds */
  link: string;
}

/** Backend event pushed to every window with the full status after a change. */
export const syncStatusChangedEvent = "sync-status-changed";
