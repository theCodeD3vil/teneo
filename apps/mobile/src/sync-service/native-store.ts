// The sync engine's store, on the phone's own database. The engine decides what
// to merge and what to send; this reads and writes the rows through native code
// (history-bridge.ts), as the Mac's sync-store.ts does through SQLite, and
// follows its rules: a row becomes a record by records.ts, a text with a
// secret is told apart, a deleted row is a tombstone, a cursor is saved with
// the batch it covers.
import { findLink } from "@teneo/shared/detection/links";
import { findSecrets } from "@teneo/shared/detection/secrets";
import { detectionVersion } from "@teneo/shared/detection/version";
import type {
  ItemRecord,
  PeerPatch,
  PeerRecord,
  StoredChange,
  SyncStore,
  SyncTransaction,
} from "@teneo/sync";

import {
  type Detection,
  type HistoryBridge,
  type WireBatch,
  type WireRow,
} from "./history-bridge";
import {
  type SyncRow,
  holdsSecret,
  recordToColumns,
  rowToRecord,
} from "./records";

/** A transaction that kept finding the history changed under it gives up */
const maxAttempts = 8;

/** Phone rows never carry the Mac's `encrypted` flag, and are all text */
const asSyncRow = (row: WireRow): SyncRow => ({
  ...row,
  kind: "text",
  encrypted: null,
});

type Found = Pick<
  WireRow,
  "secrets" | "linkUrl" | "linkHost" | "detectorVersion"
>;

/** What is stored of the secrets and link in a text, as the Mac's detectInText
 *  finds them. Throws if the rules do. */
function detect(text: string): { detection: Detection; found: Found } {
  const secrets = findSecrets(text);
  const link = findLink(text);
  return {
    detection: { id: "", secrets, link },
    found: {
      // as the Mac stores them: JSON of the spans, or NULL for none
      secrets: secrets.length > 0 ? JSON.stringify(secrets) : null,
      linkUrl: link?.url ?? null,
      linkHost: link?.host ?? null,
      detectorVersion: detectionVersion,
    },
  };
}

const isUnpinned = (row: WireRow): boolean =>
  row.deletedAt === null && row.pinnedAt === null;

/** The order of the newest-unpinned query: the later copy, then the larger id */
const isNewer = (a: WireRow, b: WireRow): boolean =>
  a.dateCopied !== b.dateCopied ? a.dateCopied > b.dateCopied : a.id > b.id;

/** What the history changed under a transaction that was reading */
class Stale extends Error {}

export class NativeSyncStore implements SyncStore {
  private readonly history: HistoryBridge;
  private readonly deviceId: string;
  private lock: Promise<unknown> = Promise.resolve();

  constructor(history: HistoryBridge, deviceId: string) {
    this.history = history;
    this.deviceId = deviceId;
  }

  async epoch(): Promise<string> {
    return this.history.epoch();
  }

  async changesAfter(
    after: number,
    limit: number,
  ): Promise<{ changes: StoredChange[]; head: number }> {
    const changes: StoredChange[] = [];
    let cursor = after;
    let head = 0;
    // A page that holds rows left out (not sendable) or less than was asked (to
    // keep an answer small) must not look like the end of the changes, so keep
    // reading until `limit` are found or the rows run out.
    while (changes.length < limit) {
      const asked = limit - changes.length;
      // the rows and the head come from one moment: nothing falls between them
      const page = this.history.changesAfter(cursor, asked);
      head = page.head;
      const held = this.lookForSecrets(page.rows);
      for (const row of page.rows) {
        cursor = row.syncSeq;
        const stored = asSyncRow(row);
        const record = rowToRecord(stored, this.deviceId);
        if (record) {
          changes.push({
            seq: row.syncSeq,
            record,
            hasSecret: holdsSecret(stored) || held.has(row.id),
          });
        }
      }
      if (page.rows.length === 0 || (page.rows.length < asked && !page.capped))
        break;
    }
    return { changes, head };
  }

  /**
   * A text the capture or the share sheet saved has not been looked at yet:
   * the app looks before it lists. Sync must not send it before it has been
   * looked at, so it is looked at here, and what is found is stored for the
   * app too. Updates the rows in `rows`. Returns the ids of texts that could
   * not be looked at: those are held back, as if they held a secret.
   */
  private lookForSecrets(rows: WireRow[]): Set<string> {
    const held = new Set<string>();
    const found: Detection[] = [];
    for (const row of rows) {
      const unlooked =
        row.deletedAt === null &&
        row.value !== null &&
        (row.detectorVersion === null ||
          row.detectorVersion < detectionVersion);
      if (!unlooked) continue;
      try {
        const result = detect(row.value!);
        Object.assign(row, result.found);
        found.push({ ...result.detection, id: row.id });
      } catch {
        held.add(row.id);
      }
    }
    if (found.length > 0) {
      try {
        this.history.saveDetections(found, detectionVersion);
      } catch {
        // what was found still holds for this read; the next one looks again
      }
    }
    return held;
  }

  async getPeer(deviceId: string): Promise<PeerRecord | null> {
    return this.history.peer(deviceId);
  }

  async latestStamp(): Promise<string | null> {
    return this.history.latestStamp();
  }

  /**
   * All of it or none of it. What `work` writes is kept here until it ends and
   * then saved at once, in one database transaction. What it reads is checked
   * at that moment: if the app wrote to the history in between (a pin, a
   * copy), what `work` decided from is out of date, nothing is saved, and
   * `work` runs again on what is there now. Transactions here wait for each
   * other, so only the app can make that happen.
   */
  transaction<T>(work: (tx: SyncTransaction) => Promise<T>): Promise<T> {
    const run = this.lock.then(() => this.attempt(work));
    this.lock = run.catch(() => undefined);
    return run;
  }

  private async attempt<T>(
    work: (tx: SyncTransaction) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      const tx = new NativeTransaction(this.history, this.deviceId);
      try {
        const result = await work(tx);
        if (tx.save()) return result;
      } catch (error) {
        if (!(error instanceof Stale)) throw error;
      }
      if (attempt >= maxAttempts) {
        throw new Error("The history kept changing, so a change was not saved");
      }
    }
  }

  async trimHistory(): Promise<void> {
    this.history.trim();
  }
}

class NativeTransaction implements SyncTransaction {
  private readonly history: HistoryBridge;
  private readonly deviceId: string;
  /** The highest change number at the first read */
  private head: number | null = null;
  /** The rows as they will be written, by id: what the transaction reads sees them */
  private readonly written = new Map<string, WireRow>();
  private readonly peers = new Map<string, PeerPatch>();

  constructor(history: HistoryBridge, deviceId: string) {
    this.history = history;
    this.deviceId = deviceId;
  }

  /** The row native code answered, after checking nothing was written since the first read */
  private seen<R extends { head: number }>(answer: R): R {
    this.head ??= answer.head;
    if (answer.head !== this.head) throw new Stale();
    return answer;
  }

  private rowOf(id: string): WireRow | null {
    return this.written.get(id) ?? this.seen(this.history.row(id)).row;
  }

  async get(id: string): Promise<ItemRecord | null> {
    const row = this.rowOf(id);
    return row && rowToRecord(asSyncRow(row), this.deviceId);
  }

  async put(record: ItemRecord): Promise<void> {
    const existing = this.rowOf(record.id);
    const columns = recordToColumns(record, existing);

    // The text is looked at only when it is new to the row: the row already
    // has what was found in the text it holds.
    let found: Found = {
      secrets: null,
      linkUrl: null,
      linkHost: null,
      detectorVersion: null,
    };
    if (columns.value !== null) {
      if (existing && existing.value === columns.value) {
        found = existing;
      } else {
        try {
          found = detect(columns.value).found;
        } catch {
          // left for the app to look at, as a copy made on the phone is
        }
      }
    }

    this.written.set(record.id, {
      id: record.id,
      value: columns.value,
      dateCopied: columns.dateCopied,
      sourceAppName: columns.sourceAppName,
      sourceAppBundleId: columns.sourceAppBundleId,
      pinnedAt: columns.pinnedAt,
      pinnedStamp: columns.pinnedStamp,
      deletedAt: columns.deletedAt,
      // a row keeps who first copied it, and when
      createdAt: existing?.createdAt ?? record.createdAt,
      originDevice: existing?.originDevice ?? record.origin,
      secrets: found.secrets,
      linkUrl: found.linkUrl,
      linkHost: found.linkHost,
      detectorVersion: found.detectorVersion,
      syncSeq: 0,
    });
  }

  async newestUnpinned(): Promise<ItemRecord | null> {
    // what was written here is not saved yet: native code leaves those rows
    // out, and they are weighed against what it found
    const stored = this.seen(
      this.history.newestUnpinned([...this.written.keys()]),
    ).row;
    let newest = stored;
    for (const row of this.written.values()) {
      if (isUnpinned(row) && (newest === null || isNewer(row, newest)))
        newest = row;
    }
    return newest && rowToRecord(asSyncRow(newest), this.deviceId);
  }

  async updatePeer(deviceId: string, patch: PeerPatch): Promise<void> {
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([, value]) => value !== undefined),
    );
    this.peers.set(deviceId, { ...this.peers.get(deviceId), ...changes });
  }

  /** Save what was written. False when the history changed since it was read. */
  save(): boolean {
    if (this.written.size === 0 && this.peers.size === 0) return true;
    const batch: WireBatch = {
      // a cursor doesn't depend on what was read
      expectedHead: this.written.size > 0 ? this.head : null,
      puts: [...this.written.values()],
      peers: Object.fromEntries(this.peers),
    };
    return this.history.commit(batch);
  }
}
