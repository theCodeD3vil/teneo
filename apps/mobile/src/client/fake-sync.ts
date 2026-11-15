import type { PairResult } from "../types/client";
import type { SyncStatus } from "../types/sync";

/**
 * Pairing and sync status as they will look, with no Mac behind them: a
 * well-formed code "pairs" with a MacBook Pro. Both clients use it until the
 * phone syncs for real.
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
    const trimmed = code.trim();

    // The QR code's link (teneo://pair?v=1&k=<key>, then the Mac's addresses
    // and anything a later version adds) or a recovery code
    const isTeneoUri = /^teneo:\/\/pair\?v=1&k=[a-zA-Z0-9_-]+(&\S*)?$/.test(
      trimmed,
    );
    const isRecoveryCode =
      /^[A-Za-z0-9]{4}(-[A-Za-z0-9]{4}){2,5}$/.test(trimmed) ||
      /^[a-fA-F0-9]{32,64}$/.test(trimmed);

    if (!isTeneoUri && !isRecoveryCode) {
      return {
        ok: false,
        error:
          "Invalid pairing code. Expected a Teneo QR code or formatted recovery code.",
      };
    }

    this.status = {
      state: "connected",
      devices: [
        {
          id: "mac-host-01",
          name: "MacBook Pro",
          model: "MacBookPro18,1",
          lastSeen: Date.now(),
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
}
