import type { PairResult } from "../types/client";
import type { SyncStatus } from "../types/sync";
import { invalidCodeMessage, readPairingCode } from "./pairing-code";

/**
 * Pairing and sync status as they look, with no Mac behind them, for the app
 * in a browser: a code the sync core accepts "pairs" with a MacBook Pro.
 */
export class FakeSync {
  private status: SyncStatus = { state: "not_paired", devices: [] };
  private listeners = new Set<(status: SyncStatus) => void>();

  private notify(): void {
    for (const listener of this.listeners) {
      try {
        listener(this.copy());
      } catch {
        // Ignore listener error
      }
    }
  }

  private copy(): SyncStatus {
    return { ...this.status, devices: [...this.status.devices] };
  }

  async getSyncStatus(): Promise<SyncStatus> {
    return this.copy();
  }

  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async pair(code: string): Promise<PairResult> {
    if (this.status.state !== "not_paired") {
      return {
        ok: false,
        error: "This phone already syncs. Turn sync off before joining again.",
      };
    }
    if (!(await readPairingCode(code))) {
      return { ok: false, error: invalidCodeMessage };
    }

    this.status = {
      state: "connected",
      devices: [
        {
          id: "mac-host-01",
          name: "MacBook Pro",
          platform: "Mac",
          lastSeen: Date.now(),
          connected: true,
          maker: "",
          address: "192.168.1.20",
          firstSeen: Date.now(),
          disconnectedUs: false,
        },
      ],
    };

    this.notify();
    return { ok: true, deviceName: "MacBook Pro" };
  }

  async unpair(): Promise<void> {
    this.status = { state: "not_paired", devices: [] };
    this.notify();
  }

  async removeDevice(id: string): Promise<void> {
    if (this.status.state === "not_paired") return;
    const devices = this.status.devices.filter((device) => device.id !== id);
    this.status = {
      state: devices.some((device) => device.connected)
        ? "connected"
        : "searching",
      devices,
    };
    this.notify();
  }
}
