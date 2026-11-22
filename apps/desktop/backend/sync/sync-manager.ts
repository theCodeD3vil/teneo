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
  buildPairingLink,
  type DeviceIdentity,
  type DevicePublicIdentity,
  deviceFingerprint,
  EnrollmentInvites,
  formatRecoveryCode,
  fromBase64,
  parseEnrollmentLink,
  parseRecoveryCode,
  randomBytes,
  toBase64,
  VaultTrust,
  type VaultTrustManager,
} from "@teneo/sync";

import { devName } from "../dev-run";
import { getSettings, updateSettings } from "../settings";
import { type NetworkAddress, pairingAddresses } from "./local-address";
import type { SyncService, SyncServiceOptions } from "./service";
import type { TrustedVaultStore } from "./trusted-vault-store";

export interface SyncManagerDeps {
  /** Whether sync is switched on for this run (it is, unless TENEO_SYNC=0). */
  available(): boolean;
  start(app: TinyApp, options: SyncServiceOptions): Promise<SyncService>;
  /** Send the items holding secrets again; how many there were. */
  restampSecretItems(app: TinyApp): Promise<number>;
  /** Forget the devices paired before, and this Mac's pairing. History stays. */
  forgetPeers(app: TinyApp): Promise<void>;
  /** This Mac is being paired: give the pairing a new id. */
  newPairing(app: TinyApp): Promise<void>;
  /** How this Mac is named; "" when that can't be read. */
  computerName(): Promise<string>;
  networkAddresses(): NetworkAddress[];
  /** For what is wrong, never for item text or keys. */
  log(message: string, error: unknown): void;
  trusted?: {
    offerUpgrade(): boolean | Promise<boolean>;
    store: TrustedVaultStore;
    identity(create: boolean): Promise<DeviceIdentity>;
    join(
      identity: DeviceIdentity,
      invite: NonNullable<ReturnType<typeof parseEnrollmentLink>>,
      persist: (trust: VaultTrust) => Promise<void>,
    ): Promise<void>;
  };
}

// a dev run keeps its own vault key, so it never reads or replaces the real one
const vaultKeyName = () => devName("sync-vault-key");
/** How long a pairing code's one-time key is taken */
const pairingLifetimeMs = 10 * 60 * 1000;
/** A code with less time than this left is replaced when shown again */
const pairingRenewMs = 2 * 60 * 1000;
const vaultKeyLength = 32;

export class SyncManager {
  private readonly app: TinyApp;
  private readonly deps: SyncManagerDeps;
  private service: SyncService | null = null;
  private vaultKey: Bytes | null = null;
  /** The one-time key the pairing code on show carries, and when it stops
   *  being taken. A phone that proves it gets the vault key, once. */
  private pairing: { key: Bytes; expiresAt: number } | null = null;
  private problem: string | null = null;
  private trusted: VaultTrustManager | null = null;
  private readonly invites = new EnrollmentInvites();
  private readonly confirmed = new Map<string, number>();
  private approval: {
    deviceId: string;
    fingerprint: string;
    complete: (accept: boolean) => void;
  } | null = null;
  private joinFingerprint: string | undefined;
  private enrollmentRevision = 0;
  private deviceName: string | null = null;
  // changes run one at a time: a double click must not start two engines
  private queue: Promise<unknown> = Promise.resolve();

  constructor(app: TinyApp, deps: SyncManagerDeps) {
    this.app = app;
    this.deps = deps;
  }

  async status(): Promise<SyncStatus> {
    const available = this.deps.available();
    const current = this.trusted?.current;
    return {
      available,
      enabled: available && getSettings().syncEnabled,
      running: this.service !== null,
      problem: this.problem,
      deviceName: available ? await this.name() : "",
      devices: await this.devices(),
      ...((await this.deps.trusted?.offerUpgrade()) && {
        trustedUpgradeAvailable: true,
      }),
      ...(this.joinFingerprint && {
        trustedJoinFingerprint: this.joinFingerprint,
      }),
      ...(current && {
        trust: {
          primary:
            this.trusted?.identity.deviceId === current.pin.primary.deviceId,
          generation: current.generation,
          pendingDeviceIds: current
            .members()
            .filter(
              (device) =>
                device.deviceId !== this.trusted?.identity.deviceId &&
                this.confirmed.get(device.deviceId) !== current.generation,
            )
            .map((device) => device.deviceId),
          approval: this.approval && {
            deviceId: this.approval.deviceId,
            fingerprint: this.approval.fingerprint,
          },
        },
      }),
    };
  }

  /** At launch, once the history is checked for secrets: carry on as before. */
  startIfEnabled(): Promise<void> {
    return this.serial(async () => {
      if (!this.deps.available() || !getSettings().syncEnabled) return;
      if (this.service) return;
      if (this.deps.trusted) {
        try {
          const trusted = await this.deps.trusted.store.read(() =>
            this.deps.trusted!.identity(false),
          );
          if (trusted) {
            await this.app.secrets.delete(vaultKeyName());
            await this.runTrusted(trusted);
            await this.publish();
            return;
          }
        } catch {
          this.problem =
            "Trusted sync couldn't open. Teneo won't fall back to the old sync key.";
          await this.publish();
          return;
        }
      }
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
      if (!getSettings().syncEnabled) {
        await this.requireClearedTrustedVault();
        await this.enable(randomBytes(vaultKeyLength));
      }
      return this.status();
    });
  }

  /** Join the vault of the device that gave this recovery code. */
  join(code: string): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      const invite = parseEnrollmentLink(code.trim());
      const deps = this.deps.trusted;
      if (invite && deps && (await deps.offerUpgrade())) {
        await this.requireClearedTrustedVault();
        const identity = await deps.identity(true);
        this.joinFingerprint = await deviceFingerprint(identity);
        await this.publish();
        try {
          await deps.join(identity, invite, async (snapshot) => {
            await this.stopService();
            const trusted = await deps.store.install(identity, snapshot);
            this.trusted = trusted;
            await this.app.secrets.delete(vaultKeyName());
            await updateSettings({ syncEnabled: true }, this.app);
            await this.deps.newPairing(this.app);
          });
          await this.runTrusted(this.trusted!);
        } finally {
          invite.key.fill(0);
          this.joinFingerprint = undefined;
          await this.publish();
        }
        return this.status();
      }
      if (getSettings().syncEnabled) {
        throw new Error("Turn sync off before joining other devices.");
      }
      await this.requireClearedTrustedVault();
      const key = await parseRecoveryCode(code);
      if (!key) {
        throw new Error(
          "That join code doesn't look right. Check it and try again.",
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
      await this.app.secrets.delete(vaultKeyName());
      await this.deps.trusted?.store.clear();
      await updateSettings({ syncEnabled: false }, this.app);
      await this.deps.forgetPeers(this.app);
      this.trusted = null;
      this.problem = null;
      await this.publish();
      return this.status();
    });
  }

  /** Explicit migration/root replacement. Never copy membership from v2. */
  upgradeTrusted(): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      const deps = this.deps.trusted;
      if (!deps || !(await deps.offerUpgrade()) || this.trusted)
        throw new Error("Creating a trusted vault isn't available.");
      await this.requireClearedTrustedVault();
      const identity = await deps.identity(true);
      const snapshot = await VaultTrust.create(identity);
      await this.stopService();
      try {
        const trusted = await deps.store.install(identity, snapshot);
        this.trusted = trusted;
        // Once the new credential is durable, remove the legacy credential.
        await this.app.secrets.delete(vaultKeyName());
        await updateSettings({ syncEnabled: true }, this.app);
        await this.deps.newPairing(this.app);
        await this.runTrusted(trusted);
      } catch (error) {
        this.problem = "Trusted sync couldn't start. No history was removed.";
        await this.publish();
        throw error;
      }
      await this.publish();
      return this.status();
    });
  }

  rotateTrusted(deviceId?: string): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      if (!this.trusted || !this.service)
        throw new Error("Trusted sync isn't running.");
      this.cancelEnrollment();
      await this.trusted.rotate(deviceId);
      await this.publish();
      return this.status();
    });
  }

  cancelEnrollment(): void {
    this.enrollmentRevision += 1;
    this.invites.cancel();
    this.approval?.complete(false);
  }

  answerEnrollment(
    deviceId: string,
    fingerprint: string,
    accept: boolean,
  ): void {
    if (
      this.approval?.deviceId === deviceId &&
      this.approval.fingerprint === fingerprint
    )
      this.approval.complete(accept);
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

  /** Stop syncing with one device, until it is paired again. The others
   *  carry on, and may still pass its items along. */
  removeDevice(deviceId: string): Promise<SyncStatus> {
    return this.serial(async () => {
      this.requireAvailable();
      if (!this.service) throw new Error("Turn sync on first.");
      await this.service.remove(deviceId);
      await this.publish();
      return this.status();
    });
  }

  /** What another device needs to join this one. */
  async pairingInfo(): Promise<PairingInfo> {
    this.requireAvailable();
    const { service, vaultKey } = this;
    if (!service) throw new Error("Turn sync on first.");
    const addresses =
      service.port === null
        ? []
        : pairingAddresses(this.deps.networkAddresses(), service.port);
    if (this.trusted) {
      const { current, identity } = this.trusted;
      if (current.pin.primary.deviceId !== identity.deviceId)
        throw new Error("Add devices from the primary Mac.");
      this.cancelEnrollment();
      const now = Date.now();
      return {
        recoveryCode: "",
        link: this.invites.create(current.pin, addresses, now),
        expiresAt: now + pairingLifetimeMs,
      };
    }
    if (!vaultKey) throw new Error("Turn sync on first.");
    // A code shown again keeps its key while it has time left; one used or
    // run out gets a new key, and the old code stops working
    if (!this.pairing || this.pairing.expiresAt - Date.now() < pairingRenewMs) {
      this.pairing = {
        key: randomBytes(32),
        expiresAt: Date.now() + pairingLifetimeMs,
      };
    }
    return {
      recoveryCode: await formatRecoveryCode(vaultKey),
      link: buildPairingLink(this.pairing.key, addresses),
      expiresAt: this.pairing.expiresAt,
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

  private async requireClearedTrustedVault(): Promise<void> {
    if (await this.deps.trusted?.store.has())
      throw new Error("Turn off and forget the existing trusted vault first.");
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
      await this.deps.newPairing(this.app);
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
      pairingKey: () =>
        this.pairing && Date.now() < this.pairing.expiresAt
          ? this.pairing.key
          : null,
      // spent: a photo of the code is of no use from here on
      onPaired: () => {
        this.pairing = null;
      },
    });
    this.vaultKey = key;
    this.problem =
      this.service.port === null
        ? "Teneo couldn't open a port, so other devices can't start a connection to this Mac."
        : null;
  }

  private async runTrusted(trust: VaultTrustManager): Promise<void> {
    this.trusted = trust;
    this.confirmed.clear();
    this.service = await this.deps.start(this.app, {
      trust,
      invites: this.invites,
      approveEnrollment: (device) => this.approve(device),
      onTrustConfirmed: (deviceId, generation) => {
        if (this.confirmed.get(deviceId) === generation) return;
        this.confirmed.set(deviceId, generation);
        void this.publish();
      },
      name: await this.name(),
      syncSecrets: () => getSettings().syncSecrets,
      onPeersChanged: () => void this.publish(),
      onError: (error) => this.deps.log("sync:", error),
    });
    this.problem =
      this.service.port === null
        ? "Teneo couldn't open a port, so the primary may not be reachable."
        : null;
  }

  private async approve(device: DevicePublicIdentity): Promise<boolean> {
    const revision = this.enrollmentRevision;
    const fingerprint = await deviceFingerprint(device);
    if (revision !== this.enrollmentRevision) return false;
    return new Promise((resolve) => {
      const timer = setTimeout(() => complete(false), 85_000);
      const complete = (accept: boolean) => {
        clearTimeout(timer);
        this.approval = null;
        resolve(accept);
        void this.publish();
      };
      this.approval?.complete(false);
      this.approval = { deviceId: device.deviceId, fingerprint, complete };
      void this.publish();
    });
  }

  private async stopService(): Promise<void> {
    const service = this.service;
    this.service = null;
    this.vaultKey = null;
    this.pairing = null;
    this.cancelEnrollment();
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
    const known = await service.knownPeers();
    const devices: SyncDevice[] = known
      // one disconnected here is gone from the list until it is paired again
      .filter((peer) =>
        this.trusted
          ? this.trusted.current.member(peer.deviceId) !== undefined
          : peer.removedPairing === null,
      )
      .map((peer) => ({
        deviceId: peer.deviceId,
        name: connected.get(peer.deviceId)?.name ?? peer.name,
        platform: peer.platform,
        maker: peer.maker ?? "",
        connected: connected.has(peer.deviceId),
        lastSeenAt: peer.lastSeenAt,
        address:
          connected.get(peer.deviceId)?.address ?? peer.lastAddress ?? null,
        pairedAt: peer.pairedAt,
        disconnectedUs: peer.removedUs === 1 && !connected.has(peer.deviceId),
        ...(peer.removedPairing !== null && { disconnectedHere: true }),
      }));
    // one that has just connected may not be in the table yet
    for (const peer of connected.values()) {
      if (known.some((record) => record.deviceId === peer.deviceId)) continue;
      devices.push({
        deviceId: peer.deviceId,
        name: peer.name,
        platform: peer.platform,
        maker: peer.maker,
        connected: true,
        lastSeenAt: Date.now(),
        address: peer.address ?? null,
        pairedAt: Date.now(),
        disconnectedUs: false,
      });
    }
    if (this.trusted) {
      for (const member of this.trusted.current.members()) {
        if (
          member.deviceId === this.trusted.identity.deviceId ||
          devices.some((device) => device.deviceId === member.deviceId)
        )
          continue;
        devices.push({
          deviceId: member.deviceId,
          name: `Device ${member.deviceId.slice(0, 8)}`,
          platform: "",
          maker: "",
          connected: false,
          lastSeenAt: 0,
          address: null,
          pairedAt: null,
          disconnectedUs: false,
        });
      }
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
