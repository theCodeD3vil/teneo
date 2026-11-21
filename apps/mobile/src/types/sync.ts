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
  /** Who made it, as shown: "Google"; "" when it didn't say */
  maker: string;
  /** Where it is on the network, or was last; "" when never known */
  address: string;
  /** When it first connected; 0 for one from before this was kept */
  firstSeen: number;
  /** It stopped syncing with this phone, by its user's choice: it comes back
   *  once either of the two is paired again */
  disconnectedUs: boolean;
}

export interface SyncStatus {
  state: SyncState;
  devices: PairedDevice[];
  errorMessage?: string;
}
