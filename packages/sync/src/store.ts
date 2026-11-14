// What the engine needs from an app's storage. The app (SQLite on the Mac)
// implements it; the merge rules and the cursor logic live in the engine, so
// they are written once and tested here.
import type { ItemRecord } from "./record";

/** A local text row, as the engine sees it. `seq` is its syncSeq. */
export interface StoredChange {
  seq: number;
  record: ItemRecord;
  /** The row holds a detected secret: it travels only when the user allows it. */
  hasSecret: boolean;
}

/** What a device remembers about another one. */
export interface PeerRecord {
  deviceId: string;
  name: string;
  platform: string;
  /** The other store's epoch when `receivedSeq` was read. */
  epoch: string | null;
  /** How far this device has read the other's changes. */
  receivedSeq: number;
  lastAddress: string | null;
  lastSeenAt: number;
}

export type PeerPatch = Partial<Omit<PeerRecord, "deviceId">>;

/** Reads and writes inside one transaction: all of it happens, or none. */
export interface SyncTransaction {
  get(id: string): Promise<ItemRecord | null>;
  /** Insert or replace the row, and stamp it with the next syncSeq. The app
   *  runs its own secret and link detection on the text here. */
  put(record: ItemRecord): Promise<void>;
  /** The newest unpinned item that is not deleted, by copy time, then id. */
  newestUnpinned(): Promise<ItemRecord | null>;
  /** Create the peer if it is unknown. */
  updatePeer(deviceId: string, patch: PeerPatch): Promise<void>;
}

export interface SyncStore {
  /** Random, made with the database. A different one tells a peer that its
   *  cursor into this store means nothing. */
  epoch(): Promise<string>;
  /** Text rows and tombstones with syncSeq above `after`, oldest first, at
   *  most `limit`, and the store's highest syncSeq. Both come from one
   *  snapshot, so a change made meanwhile is never skipped. */
  changesAfter(
    after: number,
    limit: number,
  ): Promise<{ changes: StoredChange[]; head: number }>;
  getPeer(deviceId: string): Promise<PeerRecord | null>;
  /** The largest pin stamp stored, to start the clock past it. */
  latestStamp(): Promise<string | null>;
  transaction<T>(work: (tx: SyncTransaction) => Promise<T>): Promise<T>;
  /** The device's own history limit. Rows it removes stay local. */
  trimHistory(): Promise<void>;
}
