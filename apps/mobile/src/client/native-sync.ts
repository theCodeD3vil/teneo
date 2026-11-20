import { toBase64 } from "@teneo/sync";

import type { PairResult } from "../types/client";
import type { SyncStatus } from "../types/sync";
import { invalidCodeMessage, readPairingCode } from "./pairing-code";
import { type SyncPlugin, toSyncStatus } from "./sync-plugin";

export interface NativeSyncOptions {
  /** How long a pairing waits for the first device, to name it */
  waitForDeviceMs?: number;
  /** Debug builds: a code given from adb */
  onDebugPair?: (code: string) => void;
}

/**
 * Pairing and sync status for the app, through SyncPlugin.java. The code is
 * checked here, with the sync core's parsers, before anything is kept: a
 * wrong one changes nothing.
 */
export class NativeSync {
  private readonly plugin: SyncPlugin;
  private readonly waitForDeviceMs: number;
  private readonly listeners = new Set<(status: SyncStatus) => void>();
  private readonly removeNativeListeners: Promise<(() => Promise<void>)[]>;

  constructor(plugin: SyncPlugin, options: NativeSyncOptions = {}) {
    this.plugin = plugin;
    this.waitForDeviceMs = options.waitForDeviceMs ?? 8000;
    const handles = [
      plugin.addListener("statusChanged", (status) =>
        this.publish(toSyncStatus(status)),
      ),
    ];
    const { onDebugPair } = options;
    if (onDebugPair) {
      handles.push(
        plugin.addListener("debugPair", (event) => onDebugPair(event.code)),
      );
    }
    this.removeNativeListeners = Promise.all(handles).then((all) =>
      all.map((handle) => () => handle.remove()),
    );
  }

  async close(): Promise<void> {
    this.listeners.clear();
    for (const remove of await this.removeNativeListeners) await remove();
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return toSyncStatus(await this.plugin.getStatus());
  }

  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async pair(code: string): Promise<PairResult> {
    const parsed = await readPairingCode(code);
    if (!parsed) return { ok: false, error: invalidCodeMessage };

    // listening first: the first device can connect before `pair` answers
    const firstDevice = this.firstConnectedDevice();
    let paired: SyncStatus;
    try {
      paired = toSyncStatus(
        await this.plugin.pair({
          vaultKey: toBase64(parsed.vaultKey),
          ...(parsed.pairing && { pairingAddresses: parsed.addresses }),
        }),
      );
    } catch (error) {
      firstDevice.cancel();
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      parsed.vaultKey.fill(0);
    }
    this.publish(paired);
    const name = await firstDevice.name;
    return { ok: true, ...(name !== null && { deviceName: name }) };
  }

  async unpair(): Promise<void> {
    this.publish(toSyncStatus(await this.plugin.unpair()));
  }

  async settingsChanged(): Promise<void> {
    await this.plugin.settingsChanged();
  }

  async requestNotifications(): Promise<boolean> {
    return (await this.plugin.requestNotifications()).granted;
  }

  /** The name of the first device to connect, or null if none does in time */
  private firstConnectedDevice(): {
    name: Promise<string | null>;
    cancel: () => void;
  } {
    let cancel = () => {};
    const name = new Promise<string | null>((resolve) => {
      const timer = setTimeout(() => done(null), this.waitForDeviceMs);
      const stop = this.onSyncStatusChanged((status) => {
        const device = status.devices.find((one) => one.connected);
        if (device) done(device.name);
      });
      function done(value: string | null) {
        clearTimeout(timer);
        stop();
        resolve(value);
      }
      cancel = () => done(null);
    });
    return { name, cancel };
  }

  private publish(status: SyncStatus): void {
    for (const listener of this.listeners) {
      try {
        listener({ ...status, devices: [...status.devices] });
      } catch {
        // Ignore listener error
      }
    }
  }
}
