export type SyncState =
  | "off"
  | "not_paired"
  | "searching"
  | "connected"
  | "error";

export interface PairedDevice {
  id: string;
  name: string;
  model: string;
  lastSeen: number;
}

export interface SyncStatus {
  state: SyncState;
  devices: PairedDevice[];
  errorMessage?: string;
}
