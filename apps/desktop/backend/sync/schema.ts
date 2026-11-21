// The tables and counters sync adds to the history database. All additive: an
// older Teneo opens the same file and ignores them.
import { randomBytes, toHex } from "@teneo/sync";
import type { Database } from "tjs:sqlite";

import { all, run } from "../sqlite";

export function createSyncTables(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS "SYNC_META" (key TEXT PRIMARY KEY, value);
    CREATE TABLE IF NOT EXISTS "SYNC_PEERS" (
      deviceId TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      platform TEXT NOT NULL DEFAULT '',
      epoch TEXT,
      receivedSeq INTEGER NOT NULL DEFAULT 0,
      lastAddress TEXT,
      lastSeenAt INTEGER NOT NULL DEFAULT 0
    );
  `);
  // added after the first release: who made the device ("google"), as it said
  const peerColumns = all<{ name: string }>(
    database,
    `PRAGMA table_info("SYNC_PEERS")`,
  ).map((column) => column.name);
  if (!peerColumns.includes("maker")) {
    database.exec(
      `ALTER TABLE "SYNC_PEERS" ADD COLUMN maker TEXT NOT NULL DEFAULT ''`,
    );
  }
  // added with disconnecting a device: the pairing it last said it has, when
  // it first connected, the pairing it had when it was disconnected here
  // (null while it is not), and whether it disconnected this Mac
  const added = {
    pairing: `TEXT NOT NULL DEFAULT ''`,
    pairedAt: `INTEGER`,
    removedPairing: `TEXT`,
    removedUs: `INTEGER NOT NULL DEFAULT 0`,
  };
  for (const [column, type] of Object.entries(added)) {
    if (peerColumns.includes(column)) continue;
    database.exec(`ALTER TABLE "SYNC_PEERS" ADD COLUMN ${column} ${type}`);
  }
  // The epoch is made with the database: a peer that sees another one knows
  // its cursor into this store means nothing. The counter only ever goes up,
  // even when rows are deleted, so a number is never handed out twice.
  run(
    database,
    `INSERT OR IGNORE INTO "SYNC_META" (key, value) VALUES ('epoch', ?)`,
    toHex(randomBytes(8)),
  );
  run(
    database,
    `INSERT OR IGNORE INTO "SYNC_META" (key, value) VALUES ('seq', 0)`,
  );
}

export function syncEpoch(database: Database): string {
  const [row] = all<{ value: string }>(
    database,
    `SELECT value FROM "SYNC_META" WHERE key = 'epoch'`,
  );
  if (!row) throw new Error("The sync epoch is missing");
  return row.value;
}

/** The highest syncSeq handed out so far. */
export function syncHead(database: Database): number {
  const [row] = all<{ value: number }>(
    database,
    `SELECT value FROM "SYNC_META" WHERE key = 'seq'`,
  );
  return row?.value ?? 0;
}

/** Hand out `count` numbers; the last of them. Sqlite is synchronous, so
 *  nothing else takes one in between. */
function reserveSyncSeqs(database: Database, count: number): number {
  run(
    database,
    `UPDATE "SYNC_META" SET value = value + ? WHERE key = 'seq'`,
    count,
  );
  return syncHead(database);
}

/** The syncSeq for a row that is about to be written. */
export function nextSyncSeq(database: Database): number {
  return reserveSyncSeqs(database, 1);
}

/** Give every row that matches `condition` a new syncSeq, each its own, so
 *  peers read them again. Returns how many rows that was. */
export function restampRows(
  database: Database,
  condition: string,
  ...values: unknown[]
): number {
  const [matches] = all<{ count: number }>(
    database,
    `SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS" WHERE ${condition}`,
    ...values,
  );
  const count = matches?.count ?? 0;
  if (count === 0) return 0;
  const before = reserveSyncSeqs(database, count) - count;
  run(
    database,
    `
      UPDATE "CLIPBOARD_ITEMS" SET syncSeq = ? + numbered.n
      FROM (
        SELECT id AS numberedId, row_number() OVER (ORDER BY dateCopied, id) AS n
        FROM "CLIPBOARD_ITEMS" WHERE ${condition}
      ) AS numbered
      WHERE "CLIPBOARD_ITEMS".id = numbered.numberedId
    `,
    before,
    ...values,
  );
  return count;
}

/** Fill in what rows from before sync lack, so they can be sent: when it was
 *  copied, which device, a stamp for each pin, and a syncSeq. This is also how
 *  the history that exists when sync is first turned on gets sent. */
export function backfillSyncColumns(
  database: Database,
  deviceId: string,
): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    run(
      database,
      `UPDATE "CLIPBOARD_ITEMS" SET createdAt = dateCopied WHERE createdAt IS NULL`,
    );
    run(
      database,
      `UPDATE "CLIPBOARD_ITEMS" SET originDevice = ? WHERE originDevice IS NULL`,
      deviceId,
    );
    // a pin from before sync, or made by an older Teneo, has no stamp: give it
    // one made from its time, and send the row again
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS"
        SET pinnedStamp = printf('%012x-0000-', pinnedAt) || ?, syncSeq = NULL
        WHERE pinnedAt IS NOT NULL AND pinnedStamp IS NULL
      `,
      deviceId,
    );
    restampRows(database, `syncSeq IS NULL`);
    // Colours began to sync after the first release. The ones copied before
    // have change numbers every peer has read past: they get new ones, once.
    const [sent] = all(
      database,
      `SELECT 1 FROM "SYNC_META" WHERE key = 'colorsSync'`,
    );
    if (!sent) {
      restampRows(database, `kind = 'color'`);
      run(
        database,
        `INSERT INTO "SYNC_META" (key, value) VALUES ('colorsSync', 1)`,
      );
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
