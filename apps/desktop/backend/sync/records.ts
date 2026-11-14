// Rows of the history table as sync records, and back. No sqlite in here, so
// bun can test it.
import { type ItemRecord, parseRecord } from "@teneo/sync";

/** Tombstones stay this long, so a device that was off meanwhile still hears
 *  of the delete. */
export const tombstoneLifetime = 30 * 24 * 60 * 60 * 1000;

/** The columns sync reads. `value` is the text, already decrypted. */
export interface SyncRow {
  id: string;
  kind: string;
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pinnedStamp: string | null;
  deletedAt: number | null;
  createdAt: number | null;
  originDevice: string | null;
  secrets: string | null;
  encrypted: number | null;
}

/** The stamp of a pin made before sync existed. It comes from when the pin was
 *  made, so every read of the row gives the same one. */
export function pinStampFor(pinnedAt: number, deviceId: string): string {
  return `${pinnedAt.toString(16).padStart(12, "0")}-0000-${deviceId}`;
}

/** Whether sync holds back this row unless the user allows secrets. */
export function holdsSecret(
  row: Pick<SyncRow, "secrets" | "encrypted">,
): boolean {
  return row.secrets !== null || row.encrypted === 1;
}

/** The record a row stands for, or null when it can't be one: not text, or a
 *  field a peer would refuse (a text over 1 MB is one). A deleted row is always
 *  sent as a tombstone, even one deleted before sync, whose text is still here. */
export function rowToRecord(row: SyncRow, deviceId: string): ItemRecord | null {
  if (row.kind !== "text") return null;
  const deleted = row.deletedAt !== null;

  let pinned: ItemRecord["pinned"] = null;
  if (row.pinnedAt !== null) {
    pinned = {
      at: deleted ? null : row.pinnedAt,
      stamp: row.pinnedStamp ?? pinStampFor(row.pinnedAt, deviceId),
    };
  } else if (row.pinnedStamp !== null) {
    pinned = { at: null, stamp: row.pinnedStamp };
  }

  return parseRecord({
    id: row.id,
    kind: "text",
    text: deleted ? null : row.value,
    createdAt: row.createdAt ?? row.dateCopied,
    origin: row.originDevice ?? deviceId,
    dateCopied: row.dateCopied,
    // "" and null both mean no app, and a record keeps one of them
    sourceApp: row.sourceAppName || null,
    pinned,
    deletedAt: row.deletedAt,
  });
}

/** What a record sets on its row. `value` is plain: the caller encrypts it. */
export interface RecordColumns {
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pinnedStamp: string | null;
  deletedAt: number | null;
}

/** `existing` is the row being replaced, if any: its bundle id stays while the
 *  app name stays, since a record carries only the name. */
export function recordToColumns(
  record: ItemRecord,
  existing: Pick<SyncRow, "sourceAppName" | "sourceAppBundleId"> | null,
): RecordColumns {
  const sameApp =
    existing !== null && existing.sourceAppName === record.sourceApp;
  return {
    value: record.deletedAt === null ? record.text : null,
    dateCopied: record.dateCopied,
    sourceAppName: record.sourceApp,
    sourceAppBundleId: sameApp ? existing.sourceAppBundleId : null,
    // a deleted item is not pinned, whatever its pin says
    pinnedAt: record.deletedAt === null ? (record.pinned?.at ?? null) : null,
    pinnedStamp: record.pinned?.stamp ?? null,
    deletedAt: record.deletedAt,
  };
}
