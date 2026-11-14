// What the app does with sync: turn it on or off, join another device's vault,
// and say how it is going. Everything it needs from outside is passed in, so it
// runs under `bun test` with no runtime, Keychain or network.
import {
  type PairingInfo,
  type SyncDevice,
  type SyncStatus,
  syncStatusChangedEvent,
} from "@teneo/shared/types/sync";
import {
  type Bytes,
  type PeerRecord,
  buildPairingLink,
  formatRecoveryCode,
  fromBase64,
  parseRecoveryCode,
  randomBytes,
  toBase64,
} from "@teneo/sync";

import { devName } from "../dev-run";
import { getSettings, updateSettings } from "../settings";
import { type NetworkAddress, pairingAddresses } from "./local-address";
import type { SyncService, SyncServiceOptions } from "./service";

export interface SyncManagerDeps {
  /** Whether this build has sync switched on (a beta, or TENEO_SYNC=1). */
  available(): boolean;
  start(app: TinyApp, options: SyncServiceOptions): Promise<SyncService>;
  /** Send the items holding secrets again; how many there were. */
  restampSecretItems(app: TinyApp): Promise<number>;
  /** Forget the devices paired before. History stays. */
  forgetPeers(app: TinyApp): Promise<void>;
  /** How this Mac is named; "" when that can't be read. */
  computerName(): Promise<string>;
  networkAddresses(): NetworkAddress[];
  /** For what is wrong, never for item text or keys. */
  log(message: string, error: unknown): void;
}

// a dev run keeps its own vault key, so it never reads or replaces the real one
const vaultKeyName = () => devName("sync-vault-key");
const vaultKeyLength = 32;

export class SyncManager {
  private readonly app: TinyApp;
  private readonly deps: SyncManagerDeps;
  private service: SyncService | null = null;
  private vaultKey: Bytes | null = null;
  private problem: string | null = null;
  private deviceName: string | null = null;
  // changes run one at a time: a double click must not start two engines
  private queue: Promise<unknown> = Promise.resolve();

  constructor(app: TinyApp, deps: SyncManagerDeps) {
    this.app = app;
    this.deps = deps;
  }

  async status(): Promise<SyncStatus> {
    const available = this.deps.available();
    return {
      available,
      enabled: available && getSettings().syncEnabled,
      running: this.service !== null,
      problem: this.problem,
      deviceName: available ? await this.name() : "",
      devices: await this.devices(),
    };
  }

  /** At launch, once the history is checked for secrets: carry on as before. */
  startIfEnabled(): Promise<void> {
    return this.serial(async () => {
      if (!this.deps.available() || !getSettings().syncEnabled) return;
      if (this.service) return;
      const key = await this.readVaultKey();
      if (key) {
        try {
          await this.run(key);
        } catch (error) {
          this.deps.log("starting sync failed:", error);
          this.problem = "Sync couldn't start.";
        }
      }
      await this.publish();
    });
  }

  /** Sync can't start yet: say why, so the tab doesn't wait for ever. */
  async hold(problem: string): Promise<void> {
    if (!this.deps.available() || !getSettings().syncEnabled) return;
    this.problem = problem;
    await this.publish();
  }

  /** Create a vault on this device and start syncing. */
  turnOn(): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      if (!getSettings().syncEnabled)
        await this.enable(randomBytes(vaultKeyLength));
      return this.status();
    });
  }

  /** Join the vault of the device that gave this recovery code. */
  join(code: string): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      if (getSettings().syncEnabled) {
        throw new Error("Turn sync off before joining other devices.");
      }
      const key = await parseRecoveryCode(code);
      if (!key) {
        throw new Error(
          "That recovery code doesn't look right. Check it and try again.",
        );
      }
      await this.enable(key);
      return this.status();
    });
  }

  /** Stop, forget the vault key and the paired devices. History stays. */
  turnOff(): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      await this.stopService();
      await updateSettings({ syncEnabled: false }, this.app);
      await this.deps.forgetPeers(this.app);
      await this.app.secrets.delete(vaultKeyName());
      this.problem = null;
      await this.publish();
      return this.status();
    });
  }

  /** Let items holding secrets travel, or not. Turning it on sends the ones
   *  that were held back. */
  setSyncSecrets(enabled: boolean): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      const wasOn = getSettings().syncSecrets;
      await updateSettings({ syncSecrets: enabled }, this.app);
      if (enabled && !wasOn && this.service) {
        const held = await this.deps.restampSecretItems(this.app);
        if (held > 0) this.service.localChanged();
      }
      return this.status();
    });
  }

  /** What another device needs to join this one. */
  async pairingInfo(): Promise<PairingInfo> {
    this.requireAvailable();
    const { service, vaultKey } = this;
    if (!service || !vaultKey) throw new Error("Turn sync on first.");
    const addresses =
      service.port === null
        ? []
        : pairingAddresses(this.deps.networkAddresses(), service.port);
    return {
      recoveryCode: await formatRecoveryCode(vaultKey),
      link: buildPairingLink(vaultKey, addresses),
    };
  }

  /** The app is quitting: end the connections and what announces this Mac. */
  stop(): Promise<void> {
    return this.serial(() => this.stopService());
  }

  /** The window process is gone and this one exits next, with no time to
   *  wait for `stop`: end what announces this Mac right now. The rest ends
   *  with the process. */
  stopAnnouncing(): void {
    this.service?.stopAnnouncing();
  }

  // --- the parts

  private requireAvailable(): void {
    if (!this.deps.available()) {
      throw new Error("Sync isn't available in this version of Teneo.");
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  /** Keep the key, say sync is on, then start. Undone if it can't start. */
  private async enable(key: Bytes): Promise<void> {
    let saved = false;
    try {
      saved = await this.app.secrets.set(vaultKeyName(), toBase64(key));
    } catch (error) {
      this.deps.log("saving the sync key failed:", error);
    }
    if (!saved) {
      throw new Error("Teneo couldn't save the sync key to your Keychain.");
    }
    // from here a delete leaves a tombstone for the other devices
    await updateSettings({ syncEnabled: true }, this.app);
    try {
      await this.run(key);
    } catch (error) {
      this.deps.log("starting sync failed:", error);
      await updateSettings({ syncEnabled: false }, this.app);
      await this.app.secrets.delete(vaultKeyName());
      throw new Error("Sync couldn't start.");
    }
    await this.publish();
  }

  private async run(key: Bytes): Promise<void> {
    this.service = await this.deps.start(this.app, {
      vaultKey: key,
      name: await this.name(),
      syncSecrets: () => getSettings().syncSecrets,
      onPeersChanged: () => void this.publish(),
      onError: (error) => this.deps.log("sync:", error),
    });
    this.vaultKey = key;
    this.problem =
      this.service.port === null
        ? "Teneo couldn't open a port, so other devices can't start a connection to this Mac."
        : null;
  }

  private async stopService(): Promise<void> {
    const service = this.service;
    this.service = null;
    this.vaultKey = null;
    await service?.stop();
  }

  /** The vault key from the Keychain, or null with the reason in `problem`. */
  private async readVaultKey(): Promise<Bytes | null> {
    try {
      const saved = await this.app.secrets.get(vaultKeyName());
      const key = saved ? fromBase64(saved) : null;
      if (key?.length === vaultKeyLength) return key;
      this.problem =
        "Teneo can't find this Mac's sync key. Turn sync off, then join again.";
    } catch (error) {
      this.deps.log("reading the sync key failed:", error);
      this.problem = "Teneo couldn't read its sync key from your Keychain.";
    }
    return null;
  }

  private async name(): Promise<string> {
    this.deviceName ??= (await this.deps.computerName()) || "This Mac";
    return this.deviceName;
  }

  private async devices(): Promise<SyncDevice[]> {
    const { service } = this;
    if (!service) return [];
    const connected = new Map(
      service.peers().map((peer) => [peer.deviceId, peer]),
    );
    const known: PeerRecord[] = await service.knownPeers();
    const devices: SyncDevice[] = known.map((peer) => ({
      deviceId: peer.deviceId,
      name: connected.get(peer.deviceId)?.name ?? peer.name,
      platform: peer.platform,
      connected: connected.has(peer.deviceId),
      lastSeenAt: peer.lastSeenAt,
    }));
    // one that has just connected may not be in the table yet
    for (const peer of connected.values()) {
      if (known.some((record) => record.deviceId === peer.deviceId)) continue;
      devices.push({
        deviceId: peer.deviceId,
        name: peer.name,
        platform: peer.platform,
        connected: true,
        lastSeenAt: Date.now(),
      });
    }
    return devices.sort(
      (a, b) =>
        Number(b.connected) - Number(a.connected) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
  }

  /** Tell every window how sync is going now. */
  private async publish(): Promise<void> {
    try {
      this.app.push(syncStatusChangedEvent, await this.status());
    } catch (error) {
      this.deps.log("telling the windows about sync failed:", error);
    }
  }
}
