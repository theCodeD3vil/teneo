// A SyncStore in memory, with the local writes an app makes (copy, pin,
// delete). Tests drive the engine with it, and the Mac's SQLite store has to
// behave the same way.
import { randomBytes, toHex } from "../crypto";
import type { Hlc } from "../hlc";
import type { ItemRecord } from "../record";
import type {
  PeerPatch,
  PeerRecord,
  StoredChange,
  SyncStore,
  SyncTransaction,
} from "../store";

interface Row {
  record: ItemRecord;
  seq: number;
  secret: boolean;
}

export interface CopyOptions {
  /** Forces a new item with this id, even for text that was just copied. */
  id?: string;
  secret?: boolean;
  sourceApp?: string | null;
}

export class MemoryStore implements SyncStore {
  readonly epochId = toHex(randomBytes(8));
  /** Every cursor saved for a peer, in order: one per applied batch. */
  readonly cursorSaves: { deviceId: string; seq: number }[] = [];
  trimCount = 0;
  /** Unpinned items kept by trimHistory; null keeps all. */
  historyLimit: number | null = null;
  /** Makes the Nth put of a transaction fail, to test that it rolls back. */
  failPutNumber: number | null = null;

  private readonly deviceId: string;
  private readonly idPrefix: string;
  private readonly clock: Hlc;
  private readonly now: () => number;
  private rows = new Map<string, Row>();
  private peers = new Map<string, PeerRecord>();
  private seq = 0;
  private lock: Promise<unknown> = Promise.resolve();
  private idCounter = 0;

  constructor(
    deviceId: string,
    clock: Hlc,
    now: () => number,
    idPrefix = deviceId.slice(0, 4),
  ) {
    this.deviceId = deviceId;
    this.idPrefix = idPrefix;
    this.clock = clock;
    this.now = now;
  }

  /** The highest syncSeq handed out so far. */
  get head(): number {
    return this.seq;
  }

  // --- what the app does locally

  /** Copying what is already the newest item bumps it, like the desktop app. */
  copy(text: string, options: CopyOptions = {}): string {
    const newest = this.newestUnpinnedRow();
    if (newest && !options.id && newest.record.text === text) {
      this.write(
        {
          ...newest.record,
          dateCopied: this.now(),
          sourceApp: options.sourceApp ?? newest.record.sourceApp,
        },
        newest.secret,
      );
      return newest.record.id;
    }
    const time = this.now();
    const id = options.id ?? `${this.idPrefix}-${++this.idCounter}`;
    this.write(
      {
        id,
        kind: "text",
        text,
        createdAt: time,
        origin: this.deviceId,
        dateCopied: time,
        sourceApp: options.sourceApp ?? null,
        pinned: null,
        deletedAt: null,
      },
      options.secret ?? false,
    );
    return id;
  }

  pin(id: string, pinned: boolean): void {
    const { record, secret } = this.row(id);
    this.write(
      {
        ...record,
        pinned: { at: pinned ? this.now() : null, stamp: this.clock.next() },
      },
      secret,
    );
  }

  remove(id: string): void {
    const { record, secret } = this.row(id);
    this.write({ ...record, text: null, deletedAt: this.now() }, secret);
  }

  /** Rows of a kind that never syncs, such as images, still take a syncSeq,
   *  so the store's head can be ahead of its last text row. */
  imagesCopied(count = 1): void {
    this.seq += count;
  }

  /** What the app does when "sync items with secrets" is turned on: rows left
   *  out so far get a new syncSeq, so every peer's cursor is behind them. */
  restampSecrets(): void {
    for (const { record, secret } of this.rows.values()) {
      if (secret) this.write(record, secret);
    }
  }

  /** Every record, tombstones included, in id order. */
  snapshot(): ItemRecord[] {
    return [...this.rows.values()]
      .map((row) => row.record)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
  }

  has(id: string): boolean {
    return this.rows.has(id);
  }

  liveTexts(): string[] {
    return this.snapshot().flatMap((r) =>
      r.deletedAt === null ? [r.text!] : [],
    );
  }

  private row(id: string): Row {
    const row = this.rows.get(id);
    if (!row) throw new Error(`No item ${id}`);
    return row;
  }

  private write(record: ItemRecord, secret: boolean): void {
    this.rows.set(record.id, { record, seq: ++this.seq, secret });
  }

  private newestUnpinnedRow(): Row | null {
    const candidates = [...this.rows.values()].filter(
      ({ record }) =>
        record.deletedAt === null &&
        (record.pinned === null || record.pinned.at === null),
    );
    candidates.sort((a, b) =>
      a.record.dateCopied !== b.record.dateCopied
        ? b.record.dateCopied - a.record.dateCopied
        : a.record.id < b.record.id
          ? -1
          : 1,
    );
    return candidates[0] ?? null;
  }

  // --- SyncStore

  async epoch(): Promise<string> {
    return this.epochId;
  }

  async changesAfter(
    after: number,
    limit: number,
  ): Promise<{ changes: StoredChange[]; head: number }> {
    const changes = [...this.rows.values()]
      .filter((row) => row.seq > after)
      .sort((a, b) => a.seq - b.seq)
      .slice(0, limit)
      .map((row) => ({
        seq: row.seq,
        record: row.record,
        hasSecret: row.secret,
      }));
    return { changes, head: this.seq };
  }

  async getPeer(deviceId: string): Promise<PeerRecord | null> {
    return this.peers.get(deviceId) ?? null;
  }

  async latestStamp(): Promise<string | null> {
    let latest: string | null = null;
    for (const { record } of this.rows.values()) {
      if (record.pinned && (latest === null || record.pinned.stamp > latest)) {
        latest = record.pinned.stamp;
      }
    }
    return latest;
  }

  transaction<T>(work: (tx: SyncTransaction) => Promise<T>): Promise<T> {
    const run = this.lock.then(async () => {
      const saved = {
        rows: new Map(this.rows),
        peers: new Map(this.peers),
        seq: this.seq,
      };
      const savedCursors = this.cursorSaves.length;
      let puts = 0;
      const tx: SyncTransaction = {
        get: async (id) => this.rows.get(id)?.record ?? null,
        put: async (record) => {
          puts += 1;
          if (this.failPutNumber !== null && puts === this.failPutNumber) {
            throw new Error("The disk is full");
          }
          this.write(record, this.rows.get(record.id)?.secret ?? false);
        },
        newestUnpinned: async () => this.newestUnpinnedRow()?.record ?? null,
        updatePeer: async (deviceId: string, patch: PeerPatch) => {
          const known = this.peers.get(deviceId) ?? {
            deviceId,
            name: "",
            platform: "",
            epoch: null,
            receivedSeq: 0,
            lastAddress: null,
            lastSeenAt: 0,
          };
          this.peers.set(deviceId, { ...known, ...patch });
          if (patch.receivedSeq !== undefined) {
            this.cursorSaves.push({ deviceId, seq: patch.receivedSeq });
          }
        },
      };
      try {
        return await work(tx);
      } catch (error) {
        this.rows = saved.rows;
        this.peers = saved.peers;
        this.seq = saved.seq;
        this.cursorSaves.length = savedCursors;
        throw error;
      }
    });
    this.lock = run.catch(() => undefined);
    return run;
  }

  async trimHistory(): Promise<void> {
    this.trimCount += 1;
    if (this.historyLimit === null) return;
    const unpinned = [...this.rows.values()]
      .filter(
        ({ record }) =>
          record.deletedAt === null &&
          (record.pinned === null || record.pinned.at === null),
      )
      .sort((a, b) => b.record.dateCopied - a.record.dateCopied);
    for (const { record } of unpinned.slice(this.historyLimit))
      this.rows.delete(record.id);
  }
}
