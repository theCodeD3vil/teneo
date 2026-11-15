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
  // an image: where its file is (null while its bytes are on their way, and
  // in a tombstone), its size as JSON, and what a record says of its bytes
  path?: string | null;
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

/** What a row is to sync. A colour travels as the text it was copied as: the
 *  device that takes it finds the colour in it again, each in its own way
 *  (a Mac keeps it as a colour item, a phone as a text it shows as one). */
export function recordKind(kind: string): "text" | "image" | null {
  if (kind === "text" || kind === "color") return "text";
  return kind === "image" ? "image" : null;
}

/** The record a row stands for, or null when it can't be one: not a text, a
 *  colour or an image, or a field a peer would refuse (a text over 1 MB is one, and so
 *  is an image whose file was never measured). A deleted row is always sent as
 *  a tombstone, even one deleted before sync, whose text is still here. */
export function rowToRecord(row: SyncRow, deviceId: string): ItemRecord | null {
  const kind = recordKind(row.kind);
  if (!kind) return null;
  const deleted = row.deletedAt !== null;
  const image = kind === "image" && !deleted ? imageOfRow(row) : null;
  if (kind === "image" && !deleted && !image) return null;

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
    kind,
    text: deleted || kind === "image" ? null : row.value,
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

/** What a record sets on its row. `value` is plain: the caller encrypts it. */
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
