import type { PluginListenerHandle } from "@capacitor/core";

import type { PairedDevice, SyncStatus } from "../types/sync";

/** A device as native code keeps it (KnownDevices.java) */
export interface NativeDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: number;
  connected: boolean;
}

/** What SyncController.java knows */
export interface NativeSyncStatus {
  paired: boolean;
  /** The sync service is running its page */
  running: boolean;
  /** What went wrong, worded for the user; null when nothing did */
  problem: string | null;
  devices: NativeDevice[];
}

/** SyncPlugin.java in the Android app */
export interface SyncPlugin {
  getStatus(): Promise<NativeSyncStatus>;
  /** Keep the vault key (base64) and start sync. Rejects with what to show. */
  /** With pairingAddresses, vaultKey is a pairing code's one-time key: the
   *  vault's comes from the Mac at those host:port addresses */
  pair(options: {
    vaultKey: string;
    pairingAddresses?: string[];
  }): Promise<NativeSyncStatus>;
  /** Stop sync, forget the key and the devices */
  unpair(): Promise<NativeSyncStatus>;
  /** A setting sync reads was saved */
  settingsChanged(): Promise<void>;
  requestNotifications(): Promise<{ granted: boolean }>;
  addListener(
    event: "statusChanged",
    listener: (status: NativeSyncStatus) => void,
  ): Promise<PluginListenerHandle>;
  /** Debug builds: a code given from adb (DebugSyncReceiver.java) */
  addListener(
    event: "debugPair",
    listener: (event: { code: string }) => void,
  ): Promise<PluginListenerHandle>;
}

const platformNames: Record<string, string> = {
  mac: "Mac",
  android: "Android",
};

function toDevice(device: NativeDevice): PairedDevice {
  return {
    id: device.id,
    name: device.name || "Unnamed device",
    platform: platformNames[device.platform] ?? (device.platform || "Device"),
    lastSeen: device.lastSeen,
    connected: device.connected,
  };
}

/** What the screens say for what native code knows */
export function toSyncStatus(native: NativeSyncStatus): SyncStatus {
  if (!native.paired) return { state: "not_paired", devices: [] };
  const devices = native.devices.map(toDevice);
  const problem = native.problem || undefined;
  const state =
    !native.running && problem
      ? "error"
      : devices.some((device) => device.connected)
        ? "connected"
        : "searching";
  return { state, devices, ...(problem && { errorMessage: problem }) };
}
