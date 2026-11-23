// The sync engine, its store, and the transport that carries it, put together:
// what the app and the dev peer both start. Nothing runs until this is called.
import {
  type Bytes,
  type ConnectedPeer,
  SyncEngine,
  type TrustedEngineOptions,
} from "@teneo/sync";

import {
  getSyncIdentity,
  initializeDatabase,
  onHistoryChanged,
} from "../database";
import { isDevRun } from "../dev-run";
import { clipboardHistoryChangedEvent } from "../types/clipboard";
import { appIconPng } from "./app-icon-source";
import type { Discovery } from "./discovery";
import { MacDiscovery } from "./discovery-macos";
import { ChildRegistry } from "./dns-sd-registry";
import { clearPartialImages, SqliteImageStore } from "./image-store";
import { LanTransport } from "./lan-transport";
import { isDisconnected, SqliteSyncStore, type StoredPeer } from "./sync-store";

interface CommonServiceOptions {
  /** Shown to the other devices. */
  name: string;
  platform?: string;
  /** Whether items holding secrets may travel. */
  syncSecrets?: () => boolean;
  /** Ports to listen on, in order of preference. */
  ports?: number[];
  discovery?: Discovery;
  onPeersChanged?: () => void;
  onLocalNetworkReady?: () => void;
  onError?: (error: unknown) => void;
}

interface LegacyServiceOptions {
  trust?: never;
  vaultKey: Bytes;
  /** The one-time key of the pairing code on show, or null (engine.ts). */
  pairingKey?: () => Bytes | null;
  /** A phone joined with it. */
  onPaired?: () => void;
}

export type SyncServiceOptions = CommonServiceOptions &
  (LegacyServiceOptions | TrustedEngineOptions);

export interface SyncService {
  readonly deviceId: string;
  /** The port listened on, or null when none was free. */
  readonly port: number | null;
  peers(): ConnectedPeer[];
  /** Every device paired before, connected or not, the disconnected too. */
  knownPeers(): Promise<StoredPeer[]>;
  /** Disconnect a device: tell it, and refuse it until it is paired again. */
  remove(deviceId: string): Promise<void>;
  /** The history was changed here: send it on. */
  localChanged(): void;
  stop(): Promise<void>;
  /** End what announces this Mac, at once and without waiting: for a quit,
   *  where the process is gone before `stop` would get that far. */
  stopAnnouncing(): void;
}

export async function startSyncService(
  app: TinyApp,
  options: SyncServiceOptions,
): Promise<SyncService> {
  await initializeDatabase(app);
  const { deviceId, clock } = getSyncIdentity();
  const store = new SqliteSyncStore(app);
  await clearPartialImages(app);
  const engine = new SyncEngine({
    deviceId,
    name: options.name,
    platform: options.platform ?? "mac",
    pairing: (await store.pairing()) ?? undefined,
    removals: {
      removed: (peerId) => store.removed(peerId),
      restore: (peerId) => store.restore(peerId),
    },
    onRemovedBy: (peer) =>
      void store
        .removedBy(peer.deviceId)
        .then(() => options.onPeersChanged?.())
        .catch((error: unknown) => options.onError?.(error)),
    store,
    syncSecrets: options.syncSecrets,
    // a phone shows the icons of the apps items were copied from, and has
    // none of its own: this Mac hands it the ones it asks for
    iconSource: { icon: (name) => appIconPng(name, app) },
    images: new SqliteImageStore(app),
    clock,
    // what came from another device is for the windows only: it is not a
    // change of this device's to send on
    onItemsChanged: () => app.push(clipboardHistoryChangedEvent),
    onPeersChanged: options.onPeersChanged,
    onError: options.onError,
    ...(options.trust
      ? {
          trust: options.trust,
          invites: options.invites,
          approveEnrollment: options.approveEnrollment,
          onTrustConfirmed: options.onTrustConfirmed,
        }
      : {
          vaultKey: options.vaultKey,
          pairingKey: options.pairingKey,
          onPaired: options.onPaired,
        }),
  });
  const discovery =
    options.discovery ??
    new MacDiscovery({
      registry: new ChildRegistry({ folder: (await app.paths()).cache }),
      onRegistration: options.onLocalNetworkReady,
    });
  const transport = new LanTransport({
    engine,
    deviceId,
    discovery,
    // Trusted devices can still exchange membership updates after a local
    // disconnect. The engine continues to block clipboard sync with them.
    knownPeers: async () =>
      (await store.listPeers()).filter((peer) =>
        options.trust
          ? options.trust.current.member(peer.deviceId) !== undefined
          : !isDisconnected(peer),
      ),
    isDisconnected: async (peerId) => {
      if (options.trust) return !options.trust.current.member(peerId);
      const peer = await store.getPeer(peerId);
      return peer !== null && isDisconnected(peer);
    },
    ports: options.ports,
    // a dev run may sync with a dev peer on this Mac (bun run sync:peer)
    allowLoopback: isDevRun(),
    onError: options.onError,
  });
  await transport.start();
  // every copy, pin, delete and clear made here goes out as it happens
  const stopListening = onHistoryChanged(() => engine.localChanged());

  return {
    deviceId,
    port: transport.port,
    peers: () => engine.peers(),
    knownPeers: () => store.listPeers(),
    async remove(peerId) {
      await store.removePeer(peerId);
      await engine.remove(peerId);
    },
    localChanged: () => engine.localChanged(),
    async stop() {
      stopListening();
      engine.stop();
      await transport.stop();
    },
    stopAnnouncing: () => discovery.stop(),
  };
}
