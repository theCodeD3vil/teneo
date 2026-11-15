export type SyncState =
  | "off"
  | "not_paired"
  | "searching"
  | "connected"
  | "error";

export interface PairedDevice {
  id: string;
  name: string;
  /** What kind of device it is, as shown: "Mac", "Android" */
  platform: string;
  /** When it was last connected; for a connected one, when it connected */
  lastSeen: number;
  connected: boolean;
}

export interface SyncStatus {
  state: SyncState;
  devices: PairedDevice[];
  errorMessage?: string;
}
