/** A device this one syncs with. */
export interface SyncDevice {
  deviceId: string;
  name: string;
  /** "mac", "android", ... as the device reported it */
  platform: string;
  /** who made it, as it said ("google"); empty when it didn't */
  maker: string;
  connected: boolean;
  /** when it was last connected, in ms since the epoch */
  lastSeenAt: number;
  /** where it is on the network now, or was last; null when never known */
  address: string | null;
  /** when it first connected; null for one from before this was kept */
  pairedAt: number | null;
  /** it stopped syncing with this device, by its user's choice: it comes
   *  back once this device is paired again */
  disconnectedUs: boolean;
  /** A local disconnect is not vault-wide revocation. */
  disconnectedHere?: boolean;
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
  trustedUpgradeAvailable?: boolean;
  trustedJoinFingerprint?: string;
  trust?: {
    primary: boolean;
    generation: number;
    pendingDeviceIds: string[];
    approval: { deviceId: string; fingerprint: string } | null;
  };
}

/** What a new device needs to join this one. Both unlock the whole history:
 *  show them only when the user asks. */
export interface PairingInfo {
  /** the vault key for typing in, in groups of four */
  recoveryCode: string;
  /** what the QR code holds: a one-time key, not the vault's */
  link: string;
  /** when the QR code stops working (ms): a phone joins by then, once */
  expiresAt: number;
}

/** Backend event pushed to every window with the full status after a change. */
export const syncStatusChangedEvent = "sync-status-changed";
