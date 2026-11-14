// The history database as the sync engine's store. The engine decides what
// to merge and what to send; this reads and writes the rows, and keeps what
// the engine needs of them: a counter that every write moves, and a cursor per
// peer saved in the same transaction as the batch it covers.
import type {
  ItemRecord,
  PeerPatch,
  PeerRecord,
  StoredChange,
  SyncStore,
  SyncTransaction,
} from "@teneo/sync";
import type { Database } from "tjs:sqlite";

import {
  decryptRow,
  detectInText,
  detectionVersion,
  getSyncIdentity,
  initializeDatabase,
  serializeSecrets,
} from "../database";
import { logError } from "../files";
import { trimClipboardHistory } from "../history-limits";
import { encryptText } from "../secret-encryption";
import { getSettings } from "../settings";
import { all, exclusive, run } from "../sqlite";
import {
  type SyncRow,
  holdsSecret,
  recordToColumns,
  rowToRecord,
} from "./records";
import { nextSyncSeq, syncEpoch, syncHead } from "./schema";

const rowColumns = `
  id, kind, value, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt,
  pinnedStamp, deletedAt, createdAt, originDevice, secrets, encrypted
`;

type StoredRow = SyncRow & { syncSeq: number };

// the order of the app's own repeat-copy check, so it uses the same index
const newestUnpinnedQuery = `
  SELECT ${rowColumns} FROM "CLIPBOARD_ITEMS"
  WHERE deletedAt IS NULL AND pinnedAt IS NULL
  ORDER BY dateCopied DESC, id DESC LIMIT 1
`;

const peerFields = [
  "name",
  "platform",
  "epoch",
  "receivedSeq",
  "lastAddress",
  "lastSeenAt",
] as const;

export class SqliteSyncStore implements SyncStore {
  private readonly app: TinyApp;

  constructor(app: TinyApp) {
    this.app = app;
  }

  async epoch(): Promise<string> {
    return syncEpoch(await initializeDatabase(this.app));
  }

  async changesAfter(
    after: number,
    limit: number,
  ): Promise<{ changes: StoredChange[]; head: number }> {
    const database = await initializeDatabase(this.app);
    const { deviceId } = getSyncIdentity();
    const changes: StoredChange[] = [];
    let cursor = after;
    let head = 0;
    // A page that holds rows left out (not readable now, or not sendable)
    // must not look like the end of the changes, so keep reading until
    // `limit` are found or the rows run out.
    while (changes.length < limit) {
      const asked = limit - changes.length;
      // the rows and the counter are read together, with no await between:
      // nothing is written meanwhile, so no change falls between the two
      const rows = all<StoredRow>(
        database,
        `
          SELECT ${rowColumns}, syncSeq FROM "CLIPBOARD_ITEMS"
          WHERE kind = 'text' AND syncSeq > ? ORDER BY syncSeq LIMIT ?
        `,
        cursor,
        asked,
      );
      head = syncHead(database);
      for (const row of rows) {
        cursor = row.syncSeq;
        // left out when the Keychain can't be read: it was logged by decryptRow
        const readable = await decryptRow(row, this.app);
        const record = readable && rowToRecord(readable, deviceId);
        if (record) {
          changes.push({
            seq: row.syncSeq,
            record,
            hasSecret: holdsSecret(row),
          });
        }
      }
      if (rows.length < asked) break;
    }
    return { changes, head };
  }

  async getPeer(deviceId: string): Promise<PeerRecord | null> {
    const [peer] = all<PeerRecord>(
      await initializeDatabase(this.app),
      `SELECT * FROM "SYNC_PEERS" WHERE deviceId = ?`,
      deviceId,
    );
    return peer ?? null;
  }

  /** Every device paired before, for the transport to look for again. */
  async listPeers(): Promise<PeerRecord[]> {
    return all<PeerRecord>(
      await initializeDatabase(this.app),
      `SELECT * FROM "SYNC_PEERS"`,
    );
  }

  async latestStamp(): Promise<string | null> {
    const [latest] = all<{ stamp: string | null }>(
      await initializeDatabase(this.app),
      `SELECT max(pinnedStamp) AS stamp FROM "CLIPBOARD_ITEMS"`,
    );
    return latest?.stamp ?? null;
  }

  /** All of it or none of it. Other writes to the history wait until it ends
   *  (see exclusive), so none of them is caught in a rollback. */
  async transaction<T>(work: (tx: SyncTransaction) => Promise<T>): Promise<T> {
    const database = await initializeDatabase(this.app);
    return exclusive(async () => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = await work(new SqliteTransaction(database, this.app));
        database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          database.exec("ROLLBACK");
        } catch {
          // sqlite already ended it, as it does for some errors
        }
        throw error;
      }
    });
  }

  trimHistory(): Promise<void> {
    return trimClipboardHistory(this.app);
  }
}

class SqliteTransaction implements SyncTransaction {
  private readonly database: Database;
  private readonly app: TinyApp;

  constructor(database: Database, app: TinyApp) {
    this.database = database;
    this.app = app;
  }

  async get(id: string): Promise<ItemRecord | null> {
    const row = this.readRow(id);
    if (!row || row.kind !== "text") return null;
    const readable = await decryptRow(row, this.app);
    return readable && rowToRecord(readable, getSyncIdentity().deviceId);
  }

  async put(record: ItemRecord): Promise<void> {
    const { database, app } = this;
    const existing = this.readRow(record.id);
    // The id belongs to a copy that isn't text (not a thing that happens with
    // random ids): leave it, rather than fail the whole batch.
    if (existing && existing.kind !== "text") {
      logError(
        `ignoring a change to ${record.id}: it is not a text here`,
        null,
      );
      return;
    }

    const columns = recordToColumns(record, existing);
    // The text itself is rewritten only when it changed: the row already has
    // it, found for and encrypted as this device is set to.
    const current = existing && (await decryptRow(existing, app));
    const textChanged =
      columns.value !== null && current?.value !== columns.value;
    const found = textChanged ? detectInText(columns.value) : null;
    const encrypted =
      found !== null &&
      getSettings().encryptSecrets &&
      found.secrets.length > 0;
    const storedValue =
      textChanged && encrypted
        ? await encryptText(columns.value!, app)
        : columns.value;

    // from here to the write there is no await
    const seq = nextSyncSeq(database);
    if (!existing) {
      run(
        database,
        `
          INSERT INTO "CLIPBOARD_ITEMS" (
            id, kind, value, dateCopied, sourceAppName, sourceAppBundleId,
            pinnedAt, pinnedStamp, deletedAt, createdAt, originDevice, syncSeq,
            encrypted, secrets, linkUrl, linkHost, detectorVersion
          )
          VALUES (?, 'text', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        record.id,
        storedValue,
        columns.dateCopied,
        columns.sourceAppName,
        columns.sourceAppBundleId,
        columns.pinnedAt,
        columns.pinnedStamp,
        columns.deletedAt,
        record.createdAt,
        record.origin,
        seq,
        encrypted ? 1 : null,
        found ? serializeSecrets(found.secrets) : null,
        found?.link?.url ?? null,
        found?.link?.host ?? null,
        found ? detectionVersion : null,
      );
      return;
    }

    const textColumns =
      columns.value === null
        ? // a tombstone: the text and what was found in it go
          `value = NULL, encrypted = NULL, secrets = NULL, linkUrl = NULL, linkHost = NULL,`
        : textChanged
          ? `value = ?, encrypted = ?, secrets = ?, linkUrl = ?, linkHost = ?, detectorVersion = ?,`
          : "";
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS" SET ${textColumns}
          dateCopied = ?, sourceAppName = ?, sourceAppBundleId = ?,
          pinnedAt = ?, pinnedStamp = ?, deletedAt = ?, syncSeq = ?
        WHERE id = ?
      `,
      ...(columns.value !== null && textChanged
        ? [
            storedValue,
            encrypted ? 1 : null,
            serializeSecrets(found!.secrets),
            found!.link?.url ?? null,
            found!.link?.host ?? null,
            detectionVersion,
          ]
        : []),
      columns.dateCopied,
      columns.sourceAppName,
      columns.sourceAppBundleId,
      columns.pinnedAt,
      columns.pinnedStamp,
      columns.deletedAt,
      seq,
      record.id,
    );
  }

  async newestUnpinned(): Promise<ItemRecord | null> {
    const [row] = all<SyncRow>(this.database, newestUnpinnedQuery);
    // an image or a file list is the newest copy: the same text before it
    // is not a repeat, as in the app's own check
    if (!row || row.kind !== "text") return null;
    const readable = await decryptRow(row, this.app);
    return readable && rowToRecord(readable, getSyncIdentity().deviceId);
  }

  async updatePeer(deviceId: string, patch: PeerPatch): Promise<void> {
    run(
      this.database,
      `INSERT INTO "SYNC_PEERS" (deviceId) VALUES (?) ON CONFLICT (deviceId) DO NOTHING`,
      deviceId,
    );
    const fields = peerFields.filter((field) => patch[field] !== undefined);
    if (fields.length === 0) return;
    run(
      this.database,
      `UPDATE "SYNC_PEERS" SET ${fields
        .map((field) => `${field} = ?`)
        .join(", ")} WHERE deviceId = ?`,
      ...fields.map((field) => patch[field]),
      deviceId,
    );
  }

  private readRow(id: string): SyncRow | null {
    const [row] = all<SyncRow>(
      this.database,
      `SELECT ${rowColumns} FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
      id,
    );
    return row ?? null;
  }
}
