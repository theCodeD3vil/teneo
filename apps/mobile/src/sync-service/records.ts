// Rows of the history table as sync records, and back. The Mac's mapping
// (apps/desktop/backend/sync/records.ts), copied rather than shared: both
// phones' and Macs' rows have to become the same records, so keep the two
// the same, and change them together. No database in here, so bun can test it.
import { type ItemRecord, parseRecord } from "@teneo/sync";

/** The columns sync reads. `value` is the text. */
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
  // an image: its size as JSON, and what a record says of its bytes. Where
  // its file is, is native code's to know.
  imageSize?: string | null;
  imageHash?: string | null;
  imageBytes?: number | null;
  imageType?: string | null;
}

/** The picture an image row holds, as a record says it; null when the row
 *  doesn't know all of it yet (its file was never measured). */
function imageOfRow(row: SyncRow): ItemRecord["image"] {
  if (!row.imageHash || !row.imageBytes || !row.imageType) return null;
  try {
    const size = JSON.parse(row.imageSize ?? "null") as {
      width?: unknown;
      height?: unknown;
    } | null;
    if (typeof size?.width !== "number" || typeof size.height !== "number") {
      return null;
    }
    return {
      hash: row.imageHash,
      bytes: row.imageBytes,
      // a clipboard may report a size in fractions of a point
      width: Math.round(size.width),
      height: Math.round(size.height),
      type: row.imageType,
    };
  } catch {
    return null;
  }
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

/** The record a row stands for, or null when it can't be one: not a text or
 *  an image, or a field a peer would refuse (a text over 1 MB is one, and so
 *  is an image whose file was never measured). A deleted row is always sent as
 *  a tombstone, even one deleted before sync, whose text is still here. */
export function rowToRecord(row: SyncRow, deviceId: string): ItemRecord | null {
  if (row.kind !== "text" && row.kind !== "image") return null;
  const deleted = row.deletedAt !== null;
  const image = row.kind === "image" && !deleted ? imageOfRow(row) : null;
  if (row.kind === "image" && !deleted && !image) return null;

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
    kind: row.kind,
    text: deleted || row.kind === "image" ? null : row.value,
    image,
    createdAt: row.createdAt ?? row.dateCopied,
    origin: row.originDevice ?? deviceId,
    dateCopied: row.dateCopied,
    // "" and null both mean no app, and a record keeps one of them
    sourceApp: row.sourceAppName || null,
    pinned,
    deletedAt: row.deletedAt,
  });
}

/** What a record sets on its row. `value` is plain: nothing here is encrypted. */
export interface RecordColumns {
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pinnedStamp: string | null;
  deletedAt: number | null;
  /** an image's size as the row keeps it, and what the record says of its
   *  bytes; all null for a text and a tombstone */
  imageSize: string | null;
  imageHash: string | null;
  imageBytes: number | null;
  imageType: string | null;
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
    imageSize: record.image
      ? JSON.stringify({
          width: record.image.width,
          height: record.image.height,
        })
      : null,
    imageHash: record.image?.hash ?? null,
    imageBytes: record.image?.bytes ?? null,
    imageType: record.image?.type ?? null,
  };
}
