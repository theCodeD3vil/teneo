// The sync engine, its store, and the transport that carries it, put together:
// what the app and the dev peer both start. Nothing runs until this is called.
import {
  type Bytes,
  type ConnectedPeer,
  type PeerRecord,
  SyncEngine,
} from "@teneo/sync";

import {
  getSyncIdentity,
  initializeDatabase,
  notifyClipboardHistoryChanged,
} from "../database";
import type { Discovery } from "./discovery";
import { MacDiscovery } from "./discovery-macos";
import { LanTransport } from "./lan-transport";
import { SqliteSyncStore } from "./sync-store";

export interface SyncServiceOptions {
  vaultKey: Bytes;
  /** Shown to the other devices. */
  name: string;
  platform?: string;
  /** Whether items holding secrets may travel. */
  syncSecrets?: () => boolean;
  /** Ports to listen on, in order of preference. */
  ports?: number[];
  discovery?: Discovery;
  onPeersChanged?: () => void;
  onError?: (error: unknown) => void;
}

export interface SyncService {
  readonly deviceId: string;
  /** The port listened on, or null when none was free. */
  readonly port: number | null;
  peers(): ConnectedPeer[];
  /** Every device paired before, connected or not. */
  knownPeers(): Promise<PeerRecord[]>;
  /** The history was changed here: send it on. */
  localChanged(): void;
  stop(): Promise<void>;
}

export async function startSyncService(
  app: TinyApp,
  options: SyncServiceOptions,
): Promise<SyncService> {
  await initializeDatabase(app);
  const { deviceId, clock } = getSyncIdentity();
  const store = new SqliteSyncStore(app);
  const engine = new SyncEngine({
    deviceId,
    name: options.name,
    platform: options.platform ?? "mac",
    vaultKey: options.vaultKey,
    store,
    syncSecrets: options.syncSecrets,
    clock,
    onItemsChanged: () => notifyClipboardHistoryChanged(app),
    onPeersChanged: options.onPeersChanged,
    onError: options.onError,
  });
  const transport = new LanTransport({
    engine,
    deviceId,
    discovery: options.discovery ?? new MacDiscovery(),
    knownPeers: () => store.listPeers(),
    ports: options.ports,
    onError: options.onError,
  });
  await transport.start();

  return {
    deviceId,
    port: transport.port,
    peers: () => engine.peers(),
    knownPeers: () => store.listPeers(),
    localChanged: () => engine.localChanged(),
    async stop() {
      engine.stop();
      await transport.stop();
    },
  };
}
