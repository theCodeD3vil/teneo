import { findLink } from "@teneo/shared/detection/links";
import { findSecrets } from "@teneo/shared/detection/secrets";
import { detectionVersion } from "@teneo/shared/detection/version";
import { textPreviewLength } from "@teneo/shared/types/clipboard";
import type {
  ClipboardLink,
  ClipboardListCursor,
  ClipboardListPage,
  ClipboardListRequest,
  SecretSpan,
} from "@teneo/shared/types/clipboard";
import { Database } from "tjs:sqlite";

import { type LatestCopy, isRepeatCopy } from "./duplicate-copy";
import { getFileSize } from "./file-previews";
import { logError } from "./files";
import {
  createVerifiedHistoryKeyEnvelope,
  historyHardwareAvailable,
  historyProtectionChangedEvent,
  historySecretsLockedEvent,
  type HistoryProtectionStatus,
  readHistoryKeyEnvelope,
} from "./history-key-envelope";
import {
  afterCursor,
  likePattern,
  matchesSearch,
  pageOrder,
  truncateTextPreview,
} from "./history-query";
import { appPaths } from "./paths";
import {
  areHistorySecretsLocked,
  assertHistoryUnlocked,
  currentHistoryKeyEnvelope,
  decryptText,
  deleteEncryptionKey,
  encryptText,
  encryptHistoryText,
  importEncryptionKey,
  HistoryKeychainAccessRequired,
  LockedHistoryError,
  lockHistorySecrets,
  needsHistoryKeychainAccess,
  prepareEncryptionKey,
  removeLegacyEncryptionKey,
  restrictToSavedEncryptionKey,
  restoreHistoryKeychainAccess,
  setHistoryKeyEnvelope,
  unlockHistorySecrets,
  hasHardwareHistoryKey,
} from "./secret-encryption";
import { getSettings, isSettingSaved, updateSettings } from "./settings";
import { all, checkpoint, exclusive, run, transaction } from "./sqlite";
import { type SyncIdentity, loadSyncIdentity } from "./sync/identity";
import { recordKind, tombstoneLifetime } from "./sync/records";
import {
  backfillSyncColumns,
  createSyncTables,
  nextSyncSeq,
  restampRows,
} from "./sync/schema";
import type {
  ClipboardHistoryItem,
  ClipboardItemColumn,
  ClipboardItemKind,
  ClipboardItemRow,
  ClipboardItemToSave,
} from "./types/clipboard";
import { clipboardHistoryChangedEvent } from "./types/clipboard";
import { generateUUID } from "./utils/uuid-generator";

export type { ClipboardHistoryItem } from "./types/clipboard";

let databasePromise: Promise<Database> | null = null;

export function initializeDatabase(app: TinyApp): Promise<Database> {
  databasePromise ??= openDatabase(app);
  return databasePromise;
}

let syncIdentity: SyncIdentity | null = null;

/** This device's id and pin clock. Every function that writes has awaited
 *  initializeDatabase first, which is when they are made. */
export function getSyncIdentity(): SyncIdentity {
  if (!syncIdentity) throw new Error("The database is not open yet");
  return syncIdentity;
}

async function openDatabase(app: TinyApp): Promise<Database> {
  const { data } = await appPaths(app); // already created by the time it resolves
  const database = new Database(`${data}/teneo.sqlite`);
  // WAL: listing a page while a copy is saved doesn't wait for the save, and
  // a save doesn't wait for the disk to sync (NORMAL is still safe against a
  // crash). The timeout covers a second process holding the file briefly.
  // secure_delete: what a delete or an update replaces is overwritten with
  // zeros, so a deleted copy, or a key from before it was encrypted, isn't
  // left in the file's free space.
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
    PRAGMA secure_delete = ON;
  `);
  database.exec(`
      CREATE TABLE IF NOT EXISTS "CLIPBOARD_ITEMS" (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL CHECK(kind IN ('text', 'image', 'files', 'color')),
        imageSize TEXT,
        path TEXT,
        value TEXT,
        dateCopied INTEGER NOT NULL,
        sourceAppName TEXT,
        sourceAppBundleId TEXT,
        deletedAt INTEGER,
        pinnedAt INTEGER,
        pasteAsFile INTEGER,
        encrypted INTEGER
      )
  `);
  addMissingColumns(database);
  database.exec(`
    CREATE TABLE IF NOT EXISTS "HISTORY_PROTECTION" (
      id INTEGER PRIMARY KEY CHECK (id = 1), envelope TEXT NOT NULL
    )
  `);
  const [protection] = all<{ envelope: string }>(
    database,
    `SELECT envelope FROM "HISTORY_PROTECTION" WHERE id = 1`,
  );
  try {
    configureHistoryProtection(
      app,
      protection
        ? readHistoryKeyEnvelope(JSON.parse(protection.envelope))
        : null,
    );
  } catch {
    // Keep other history usable, but never fall back to a new or legacy key.
    configureHistoryProtection(app, null, true);
  }
  createIndexes(database);
  keepItemSizes(database);
  createSyncTables(database);
  syncIdentity = await loadSyncIdentity(app, database);
  backfillSyncColumns(database, syncIdentity.deviceId);

  return database;
}

// The list reads each page straight off one of these, already in order,
// instead of sorting the history: with 100k items a page takes 0.2 ms rather
// than 30 (the first page) to 60 (one deep in the scroll). Expression and
// partial indexes, so the ORDER BY matches them term for term; see listOrder
// and unpinnedOrder in history-query.ts.
const indexes = {
  // the first page, and the pages still among the pinned items
  clipboard_items_list_order_index: `
    ((pinnedAt IS NULL), pinnedAt DESC, dateCopied DESC, id DESC)
    WHERE deletedAt IS NULL`,
  clipboard_items_kind_list_order_index: `
    (kind, (pinnedAt IS NULL), pinnedAt DESC, dateCopied DESC, id DESC)
    WHERE deletedAt IS NULL`,
  // the pages past the pinned items, the repeat-copy check, and the newest-N
  // of "Maximum items" (deletionCondition), which counts deleted rows too
  clipboard_items_unpinned_index: `
    (dateCopied DESC, id DESC) WHERE pinnedAt IS NULL`,
  clipboard_items_kind_unpinned_index: `
    (kind, dateCopied DESC, id DESC) WHERE pinnedAt IS NULL`,
  // the changes a peer has not read yet (changesAfter in sync/sync-store.ts)
  clipboard_items_sync_seq_index: `(syncSeq)`,
  // which row holds, or waits for, an image's bytes (sync/image-store.ts)
  clipboard_items_image_hash_index: `(imageHash) WHERE kind = 'image'`,
  // the texts the current detection rules haven't looked at (refreshDetection)
  clipboard_items_undetected_index: `
    (detectorVersion) WHERE kind = 'text' AND value IS NOT NULL`,
  // an app's icon, asked for by name (sync/app-icon-source.ts)
  clipboard_items_source_app_index: `
    (sourceAppName) WHERE sourceAppName IS NOT NULL`,
};

function createIndexes(database: Database): void {
  for (const [name, definition] of Object.entries(indexes)) {
    database.exec(
      `CREATE INDEX IF NOT EXISTS ${name} ON "CLIPBOARD_ITEMS" ${definition}`,
    );
  }
  // The first release's index on dateCopied alone. The ones above cover it,
  // and while it exists sqlite picks it for a page deep in the scroll, then
  // sorts the result anyway.
  database.exec(`DROP INDEX IF EXISTS clipboard_items_date_copied_index`);
}

/** Save a clipboard item after transient clipboard data, such as images, is durable. */
export async function saveClipboardItem(
  item: ClipboardItemToSave,
  app: TinyApp,
): Promise<ClipboardHistoryItem> {
  if (item.kind === "empty") {
    throw new Error("Cannot save an empty clipboard item");
  }

  const dateCopied = Date.now();
  const savedItem: ClipboardHistoryItem = {
    ...item,
    kind: item.kind, // "empty" was ruled out above
    id: generateUUID(),
    dateCopied,
    pinned: false,
    pasteAsFile: item.pasteAsFile === true,
    fileSize: null, // read when history is listed
    ...detectInText(item.kind === "text" ? item.text : null),
    isTruncated: false,
  };
  // With encryption on, text holding a secret is only ever saved encrypted:
  // when the key can't be read, encryptText throws and the item isn't saved
  const value = serializeValue(savedItem);
  const database = await initializeDatabase(app);
  if (getSettings().encryptSecrets && savedItem.secrets.length)
    assertHistoryUnlocked();
  const { deviceId } = getSyncIdentity();
  // one writer at a time: a sync batch in progress finishes first
  return exclusive(async () => {
    const isEncrypted =
      getSettings().encryptSecrets &&
      value !== null &&
      savedItem.secrets.length > 0;
    const repeated = await findRepeatCopy(savedItem, database, app);
    if (repeated) {
      run(
        database,
        `
          UPDATE "CLIPBOARD_ITEMS"
          SET dateCopied = ?, sourceAppName = ?, sourceAppBundleId = ?, syncSeq = ?
          WHERE id = ?
        `,
        dateCopied,
        savedItem.sourceApp?.name ?? null,
        savedItem.sourceApp?.bundleId ?? null,
        nextSyncSeq(database),
        repeated.id,
      );
      notifyClipboardHistoryChanged(app);
      return { ...savedItem, id: repeated.id };
    }

    const storedValue = isEncrypted ? await encryptText(value, app) : value;
    const { data: dataDirectory } = await appPaths(app);

    run(
      database,
      `
        INSERT INTO "CLIPBOARD_ITEMS" (
          id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId, pasteAsFile, encrypted,
          secrets, linkUrl, linkHost, detectorVersion, createdAt, originDevice, syncSeq
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      savedItem.id,
      savedItem.kind,
      serializeImageSize(savedItem),
      serializePath(savedItem, dataDirectory),
      storedValue,
      savedItem.dateCopied,
      savedItem.sourceApp?.name ?? null,
      savedItem.sourceApp?.bundleId ?? null,
      savedItem.pasteAsFile ? 1 : null,
      isEncrypted ? 1 : null,
      serializeSecrets(savedItem.secrets),
      isEncrypted && currentHistoryKeyEnvelope()
        ? null
        : (savedItem.link?.url ?? null),
      isEncrypted && currentHistoryKeyEnvelope()
        ? null
        : (savedItem.link?.host ?? null),
      detectionVersion,
      savedItem.dateCopied,
      deviceId,
      nextSyncSeq(database),
    );
    notifyClipboardHistoryChanged(app);

    return savedItem;
  });
}

/** The newest unpinned item when it holds what `item` holds: copying the
 *  same thing again then bumps it to the top instead of adding a row. A
 *  pinned item isn't bumped, since it keeps its place among the pinned ones;
 *  the copy shows at the top of the rest. */
async function findRepeatCopy(
  item: TinyClipboardData,
  database: Database,
  app: TinyApp,
): Promise<LatestCopy | null> {
  if (item.kind === "image") return null;
  const [latest] = all<LatestCopy & Pick<ClipboardItemRow, "encrypted">>(
    database,
    `
      SELECT id, kind, value, path, encrypted FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL AND pinnedAt IS NULL
      ORDER BY dateCopied DESC, id DESC LIMIT 1
    `,
  );
  if (!latest || latest.kind !== item.kind) return null;
  // a text that can't be decrypted now isn't a repeat; the copy is saved anew
  const decrypted = await decryptRow(latest, app);
  return decrypted && isRepeatCopy(item, decrypted) ? decrypted : null;
}

export function detectInText(text: string | null): {
  secrets: SecretSpan[];
  link: ClipboardLink | null;
} {
  if (!text) return { secrets: [], link: null };
  return { secrets: findSecrets(text), link: findLink(text) };
}

export function serializeSecrets(secrets: SecretSpan[]): string | null {
  return secrets.length ? JSON.stringify(secrets) : null;
}

function parseSecrets(secrets: string | null): SecretSpan[] {
  if (!secrets) return [];
  try {
    const parsed: unknown = JSON.parse(secrets);
    return Array.isArray(parsed)
      ? parsed.filter(
          (span): span is SecretSpan =>
            !!span &&
            typeof span === "object" &&
            typeof span.start === "number" &&
            typeof span.end === "number" &&
            typeof span.label === "string",
        )
      : [];
  } catch {
    return [];
  }
}

/** Find secrets and links again in texts detected with older rules, or with
 *  none: copies from before the results were stored. Run at startup, so a
 *  rule added in an update covers older copies too. */
export async function refreshDetectionMetadata(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  await exclusive(() => refreshDetection(database, app));
}

async function refreshDetection(
  database: Database,
  app: TinyApp,
): Promise<void> {
  const rows = all<Pick<ClipboardItemRow, "id" | "value" | "encrypted">>(
    database,
    `
      SELECT id, value, encrypted FROM "CLIPBOARD_ITEMS"
      WHERE kind = 'text' AND value IS NOT NULL
        AND (detectorVersion IS NULL OR detectorVersion < ?)
    `,
    detectionVersion,
  );
  let changed = false;
  for (const row of rows) {
    // left for the next start when it can't be decrypted now
    const decrypted = await decryptRow(row, app);
    if (!decrypted) continue;
    const { secrets, link } = detectInText(decrypted.value);
    const keepLink = row.encrypted !== 1 || !currentHistoryKeyEnvelope();
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS"
        SET secrets = ?, linkUrl = ?, linkHost = ?, detectorVersion = ?
        WHERE id = ?
      `,
      serializeSecrets(secrets),
      (keepLink && link?.url) || null,
      (keepLink && link?.host) || null,
      detectionVersion,
      row.id,
    );
    changed = true;
  }
  if (changed) notifyClipboardHistoryChanged(app);
}

// The kinds whose value is a text that syncs: a colour travels as the text it
// was copied as.
const textKinds = `kind IN ('text', 'color')`;
// A deleted text or colour whose value is gone, or a deleted image whose file
// is: what sync keeps so peers hear of the delete (see tombstones below).
// Deleted before sync, a text keeps its value and an image its file.
const tombstoneRow = `(deletedAt IS NOT NULL AND (
  (${textKinds} AND value IS NULL) OR (kind = 'image' AND path IS NULL)
))`;
// ...and one still young enough that it must stay: ?  is its cutoff (ms)
const youngTombstone = `(${tombstoneRow} AND deletedAt >= ?)`;
// An image sync has heard of whose file has not arrived yet. It is not shown,
// so the limits don't count it either, or a file that never comes would take
// a shown item's place. They still delete it once it is older than the last
// item they keep, as they would if it were shown.
const waitingImage = `(kind = 'image' AND path IS NULL AND deletedAt IS NULL)`;

// Matches unpinned items copied before ?2 (ms), or after ?3/?5 in the list:
// the oldest item "Maximum items" keeps. Pinned items are never deleted or
// counted, and neither are young tombstones: they are not history, they are
// news for the other devices. Waiting images are deleted but not counted.
// Fill the five with deletionValues.
const deletionCondition = `
  pinnedAt IS NULL AND NOT ${youngTombstone} AND (
    dateCopied < ? OR dateCopied < ? OR (dateCopied = ? AND id < ?)
  )
`;

/** The values for deletionCondition. "Maximum items" is found as the oldest
 *  item it keeps, one step down an index, rather than as a NOT IN over the
 *  newest N ids, which sqlite would gather into a table on every copy. */
function deletionValues(
  database: Database,
  copiedBefore: number,
  keepNewest: number,
): (number | string)[] {
  const cutoff = Date.now() - tombstoneLifetime;
  // no limit, or fewer items than it: nothing is after the last one kept
  let lastKept: { dateCopied: number; id: string } = { dateCopied: -1, id: "" };
  if (keepNewest === 0) {
    lastKept = { dateCopied: Number.MAX_SAFE_INTEGER, id: "" };
  } else if (keepNewest > 0) {
    const [row] = all<{ dateCopied: number; id: string }>(
      database,
      `
        SELECT dateCopied, id FROM "CLIPBOARD_ITEMS"
        WHERE pinnedAt IS NULL AND NOT ${youngTombstone} AND NOT ${waitingImage}
        ORDER BY dateCopied DESC, id DESC LIMIT 1 OFFSET ?
      `,
      cutoff,
      keepNewest - 1,
    );
    if (row) lastKept = row;
  }
  return [
    cutoff,
    copiedBefore,
    lastKept.dateCopied,
    lastKept.dateCopied,
    lastKept.id,
  ];
}

/** Whether these limits can delete anything. With none set (the default)
 *  deletionCondition matches nothing, but checking it after every copy would
 *  still read the whole history. */
function limitsHistory(copiedBefore: number, keepNewest: number): boolean {
  return copiedBefore > 0 || keepNewest >= 0;
}

/** How many items in the history deleteClipboardItems would delete with
 *  these limits. Already-deleted items and waiting images still get removed,
 *  but aren't counted: they are not shown. */
export async function countClipboardItemsToDelete(
  app: TinyApp,
  copiedBefore: number,
  keepNewest: number,
): Promise<number> {
  if (!limitsHistory(copiedBefore, keepNewest)) return 0;
  const database = await initializeDatabase(app);
  const [result] = all<{ count: number }>(
    database,
    `
      SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL AND NOT ${waitingImage} AND (${deletionCondition})
    `,
    ...deletionValues(database, copiedBefore, keepNewest),
  );
  return result?.count ?? 0;
}

// What a tombstone no longer holds: the text and what was found in it
const eraseText = ["value", "secrets", "linkUrl", "linkHost", "encrypted"]
  .map(
    (column) =>
      `${column} = CASE WHEN ${textKinds} THEN NULL ELSE ${column} END`,
  )
  .join(", ");

/** Delete items copied before `copiedBefore` (ms) or beyond the newest
 *  `keepNewest` (-1 = no limit), along with their saved images. With sync on,
 *  `leaveTombstones` keeps each deleted text as a tombstone, so the other
 *  devices delete it too: for "Clear history", not for the limits, which are
 *  each device's own. */
export async function deleteClipboardItems(
  app: TinyApp,
  copiedBefore: number,
  keepNewest: number,
  { leaveTombstones = false } = {},
): Promise<void> {
  if (!limitsHistory(copiedBefore, keepNewest)) return;
  const database = await initializeDatabase(app);
  const { data: dataDirectory } = await appPaths(app);

  // Read and delete with no await in between (sqlite is sync), so an item
  // saved meanwhile can't be deleted without its image path being read
  const { deletedRows, changed } = await exclusive(async () => {
    // where the list is cut, found once: the tombstones made below drop out
    // of the newest N, and must not move it
    const values = deletionValues(database, copiedBefore, keepNewest);
    let tombstoned = 0;
    let erasedImages: Pick<ClipboardItemRow, "kind" | "path">[] = [];
    if (leaveTombstones && getSettings().syncEnabled) {
      // The texts become tombstones, and drop out of the condition below
      // while they are young. A tombstone already there stays as it is.
      run(
        database,
        `
          UPDATE "CLIPBOARD_ITEMS"
          SET deletedAt = ifnull(deletedAt, ?), pinnedAt = NULL, syncSeq = NULL, ${eraseText}
          WHERE ${textKinds} AND NOT ${tombstoneRow} AND ${deletionCondition}
        `,
        Date.now(),
        ...values,
      );
      // The images too, each without its file from here on
      erasedImages = all<Pick<ClipboardItemRow, "kind" | "path">>(
        database,
        `
          SELECT kind, path FROM "CLIPBOARD_ITEMS"
          WHERE kind = 'image' AND NOT ${tombstoneRow} AND ${deletionCondition}
        `,
        ...values,
      );
      run(
        database,
        `
          UPDATE "CLIPBOARD_ITEMS"
          SET deletedAt = ifnull(deletedAt, ?), pinnedAt = NULL, syncSeq = NULL, path = NULL
          WHERE kind = 'image' AND NOT ${tombstoneRow} AND ${deletionCondition}
        `,
        Date.now(),
        ...values,
      );
      tombstoned = restampRows(database, `syncSeq IS NULL`);
    }
    const rows = all<Pick<ClipboardItemRow, "kind" | "path">>(
      database,
      `SELECT kind, path FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
      ...values,
    );
    if (rows.length > 0) {
      run(
        database,
        `DELETE FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
        ...values,
      );
    }
    return {
      deletedRows: [...erasedImages, ...rows],
      changed: tombstoned > 0 || rows.length > 0,
    };
  });
  if (!changed) return;
  notifyClipboardHistoryChanged(app);

  // Images go after their rows, so history never points at a missing file
  for (const row of deletedRows) {
    const imagePath =
      row.kind === "image" ? restoreImagePath(row.path, dataDirectory) : null;
    if (imagePath) {
      await tjs
        .remove(imagePath)
        .catch((error: unknown) =>
          logError(`deleting ${imagePath} failed:`, error),
        );
    }
  }
}

/** Send the items that hold secrets again. They were left out while "sync
 *  items with secrets" was off, and a device that has read past a row never
 *  asks for it again. Returns how many there are. */
export async function restampSecretItems(app: TinyApp): Promise<number> {
  const database = await initializeDatabase(app);
  return exclusive(async () =>
    restampRows(
      database,
      `kind = 'text' AND deletedAt IS NULL AND (secrets IS NOT NULL OR encrypted = 1)`,
    ),
  );
}

/** Empty the write-ahead log of what was just deleted: secure_delete zeroes
 *  it in the database file itself, and the log keeps it until a checkpoint. */
export async function scrubDeletedHistory(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  await exclusive(async () => checkpoint(database));
}

/** Remove the tombstones that have been kept their 30 days: any device that
 *  was away longer than that has to be paired again. */
export async function purgeOldTombstones(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  const { data: dataDirectory } = await appPaths(app);
  const leftImages = await exclusive(async () => {
    // Before 0.4.4 an item deleted with sync off kept its text or its image
    // file, out of sight and never purged: it becomes the tombstone a delete
    // makes now, and a kind sync never carries goes altogether
    const images = all<Pick<ClipboardItemRow, "kind" | "path">>(
      database,
      `SELECT kind, path FROM "CLIPBOARD_ITEMS" WHERE deletedAt IS NOT NULL AND kind = 'image' AND path IS NOT NULL`,
    );
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS"
        SET ${eraseText}, path = CASE WHEN kind = 'image' THEN NULL ELSE path END
        WHERE deletedAt IS NOT NULL AND NOT ${tombstoneRow}
          AND (${textKinds} OR kind = 'image')
      `,
    );
    run(
      database,
      `DELETE FROM "CLIPBOARD_ITEMS" WHERE deletedAt IS NOT NULL AND NOT (${textKinds} OR kind = 'image')`,
    );
    run(
      database,
      `DELETE FROM "CLIPBOARD_ITEMS" WHERE ${tombstoneRow} AND deletedAt < ?`,
      Date.now() - tombstoneLifetime,
    );
    return images;
  });
  for (const row of leftImages) {
    const imagePath = restoreImagePath(row.path, dataDirectory);
    if (imagePath) await tjs.remove(imagePath).catch(() => undefined);
  }
}

/** Delete an item from the history. A text loses its text and an image its
 *  file, sync on or off: what is left is a tombstone, which tells the other
 *  devices to delete it (now, or once sync is turned on) and goes after 30
 *  days. A kind that never syncs (files) goes altogether. */
export async function softDeleteClipboardItem(
  id: string,
  app: TinyApp,
): Promise<void> {
  const database = await initializeDatabase(app);
  const { data: dataDirectory } = await appPaths(app);
  const imagePath = await exclusive(async () => {
    const [row] = all<Pick<ClipboardItemRow, "kind" | "path">>(
      database,
      `SELECT kind, path FROM "CLIPBOARD_ITEMS" WHERE id = ? AND deletedAt IS NULL`,
      id,
    );
    if (!row) return null;
    if (recordKind(row.kind) === null) {
      run(database, `DELETE FROM "CLIPBOARD_ITEMS" WHERE id = ?`, id);
    } else {
      run(
        database,
        `
          UPDATE "CLIPBOARD_ITEMS"
          SET deletedAt = ?, pinnedAt = NULL, syncSeq = ?, ${eraseText},
            path = CASE WHEN kind = 'image' THEN NULL ELSE path END
          WHERE id = ? AND deletedAt IS NULL
        `,
        Date.now(),
        nextSyncSeq(database),
        id,
      );
    }
    notifyClipboardHistoryChanged(app);
    return row.kind === "image"
      ? restoreImagePath(row.path, dataDirectory)
      : null;
  });
  // after its row, so history never points at a missing file
  if (imagePath) {
    await tjs
      .remove(imagePath)
      .catch((error: unknown) =>
        logError(`deleting ${imagePath} failed:`, error),
      );
  }
}

/** Pinned items list first, newest pin first, and history
 *  limits leave them alone. */
export async function setClipboardItemPinned(
  id: string,
  pinned: boolean,
  app: TinyApp,
): Promise<void> {
  const database = await initializeDatabase(app);
  const { clock } = getSyncIdentity();
  await exclusive(async () => {
    // an unpin gets a stamp too: it has to win over the pin it undoes
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS" SET pinnedAt = ?, pinnedStamp = ?, syncSeq = ?
        WHERE id = ? AND deletedAt IS NULL
      `,
      pinned ? Date.now() : null,
      clock.next(),
      nextSyncSeq(database),
      id,
    );
    notifyClipboardHistoryChanged(app);
  });
}

// A saved image never changes, so it is measured once instead of on every
// copy that applies the storage limit
let imageSizes = new Map<string, number>();

/** Bytes each history item takes, newest first: its text, color or file
 *  list, plus its saved image. The storage limit counts the unpinned ones.
 *  Young tombstones and waiting images are left out, as "Maximum items"
 *  leaves them out: the storage limit becomes a count of the newest items. */
export async function listClipboardItemSizes(
  app: TinyApp,
): Promise<Array<{ kind: string; bytes: number; pinned: boolean }>> {
  // youngTombstone and waitingImage, on the sizes table's columns
  const rows = all<
    Pick<ClipboardItemRow, "kind" | "path"> & {
      pinned: number;
      rowBytes: number;
    }
  >(
    await initializeDatabase(app),
    `
      SELECT kind, imagePath AS path, pinned, bytes AS rowBytes
      FROM "CLIPBOARD_ITEM_SIZES"
      WHERE NOT (deletedAt IS NOT NULL AND deletedAt >= ? AND (
        (${textKinds} AND NOT hasValue) OR (kind = 'image' AND NOT hasPath)
      ))
      AND NOT (kind = 'image' AND NOT hasPath AND deletedAt IS NULL)
      ORDER BY dateCopied DESC, id DESC
    `,
    Date.now() - tombstoneLifetime,
  );
  const { data: dataDirectory } = await appPaths(app);
  const measuredImages = new Map<string, number>();
  // only an image not measured before is looked at on disk: a copy adds one
  const unmeasured = rows.flatMap((row) => {
    const imagePath =
      row.kind === "image" ? restoreImagePath(row.path, dataDirectory) : null;
    return imagePath && !imageSizes.has(imagePath) ? [imagePath] : [];
  });
  const measured = new Map(
    await Promise.all(
      unmeasured.map(
        async (imagePath) =>
          [
            imagePath,
            await tjs.stat(imagePath).then(
              (stat: { size: number }) => stat.size,
              () => undefined,
            ),
          ] as const,
      ),
    ),
  );
  const sizes = rows.map((row) => {
    const imagePath =
      row.kind === "image" ? restoreImagePath(row.path, dataDirectory) : null;
    // a missing image file takes no space
    let imageBytes = 0;
    if (imagePath) {
      const bytes = imageSizes.get(imagePath) ?? measured.get(imagePath);
      if (bytes !== undefined) {
        measuredImages.set(imagePath, bytes);
        imageBytes = bytes;
      }
    }
    return {
      kind: row.kind,
      bytes: row.rowBytes + imageBytes,
      pinned: row.pinned === 1,
    };
  });
  imageSizes = measuredImages; // images no longer in history drop out
  return sizes;
}

/** How many images, and how many copied files, history holds. */
export async function countClipboardMedia(
  app: TinyApp,
): Promise<{ imageCount: number; fileCount: number }> {
  const [counts] = all<{ imageCount: number; fileCount: number | null }>(
    await initializeDatabase(app),
    `
      SELECT
        -- only images with a file: not a waiting one, nor an image's tombstone
        COUNT(*) FILTER (WHERE kind = 'image' AND path IS NOT NULL) AS imageCount,
        SUM(CASE WHEN kind = 'files' THEN json_array_length(path) END) AS fileCount
      FROM "CLIPBOARD_ITEMS"
    `,
  );
  return {
    imageCount: counts?.imageCount ?? 0,
    fileCount: counts?.fileCount ?? 0,
  };
}

// Besides the windows, the sync engine wants to hear that this device changed
// its history, to send the change on
const historyListeners = new Set<() => void>();

/** `listener` runs after each change this device makes to its history. Returns
 *  what takes it off again. */
export function onHistoryChanged(listener: () => void): () => void {
  historyListeners.add(listener);
  return () => void historyListeners.delete(listener);
}

/** Call after every committed clipboard-history insert, update, or deletion. */
export function notifyClipboardHistoryChanged(app: TinyApp): void {
  app.push(clipboardHistoryChangedEvent);
  for (const listener of historyListeners) {
    try {
      listener();
    } catch (error) {
      // the change is made: a listener must not undo that by throwing
      logError("a history listener failed:", error);
    }
  }
}

// Who made the device an item was copied on ("google"), for its logo on the
// card. Only a device that said so has one: a phone, never this Mac.
const originMakerColumn = `
  (SELECT maker FROM "SYNC_PEERS" WHERE deviceId = originDevice) AS originMaker
`;

// The list reads only the start of a long text: the card shows two lines, and
// the whole text comes by id when it's previewed or copied. A text holding a
// secret is read whole, so the search can tell the secret from the rest.
/** The columns a list reads. A text comes cut down to its preview, except
 *  an encrypted one, which is decrypted whole, and, when `searching`, one
 *  holding a secret: the search tells the secret from the rest of it. */
const listColumns = (searching: boolean) => `
  id, kind, imageSize, path, dateCopied, sourceAppName, sourceAppBundleId,
  pinnedAt, pasteAsFile, encrypted, secrets, linkUrl, linkHost,
  ${originMakerColumn},
  CASE WHEN kind != 'text' OR encrypted IS 1${searching ? " OR secrets IS NOT NULL" : ""}
    THEN value ELSE substr(value, 1, ?) END AS value,
  length(value) AS valueLength
`;

/** One page of the history: pinned items first, then newest first. Only the
 *  rows of the page are decrypted and looked at, not the whole history. */
export async function listClipboardItems(
  app: TinyApp,
  request: ClipboardListRequest,
): Promise<ClipboardListPage> {
  const database = await initializeDatabase(app);
  const { data: dataDirectory } = await appPaths(app);
  const search = request.search.trim().toLowerCase();
  const { maskSecrets } = getSettings();
  const items: ClipboardHistoryItem[] = [];
  let cursor = request.cursor;
  let exhausted = false;

  // The query matches a page's worth of rows; the few a row-by-row check
  // then drops (a search hit inside a masked key, a text that can't be
  // decrypted) are made up for from the rows after them.
  while (items.length < request.limit && !exhausted) {
    const batchSize = Math.max(request.limit - items.length, 20);
    const { where, values } = listConditions(request.kind, search, cursor);
    const rows = all<ClipboardItemRow>(
      database,
      `
        SELECT ${listColumns(search !== "")} FROM "CLIPBOARD_ITEMS"
        WHERE ${where} ORDER BY ${pageOrder(cursor)} LIMIT ?
      `,
      textPreviewLength,
      ...values,
      batchSize,
    );
    let reachedLimit = false;
    for (const row of rows) {
      cursor = {
        pinnedAt: row.pinnedAt,
        dateCopied: row.dateCopied,
        id: row.id,
      };
      const decrypted = await decryptRow(row, app);
      if (!decrypted) continue;
      if (search && needsSearchCheck(row, maskSecrets)) {
        if (!matchesSearch(toSearchable(decrypted), search, maskSecrets))
          continue;
      }
      const item = rowToClipboardItem(decrypted, dataDirectory, true);
      if (!item) continue;
      items.push(item);
      if (items.length === request.limit) {
        reachedLimit = true;
        break;
      }
    }
    if (!reachedLimit && rows.length < batchSize) exhausted = true;
  }

  await readFileSizes(items, app);
  return {
    items,
    nextCursor: exhausted ? null : (cursor ?? null),
    // the first page's count stands for the list: with a search, counting
    // reads every encrypted row, too costly to repeat for each page
    total: request.cursor
      ? null
      : await countClipboardItems(app, request.kind, search, maskSecrets),
  };
}

/** One item whole, with all of its text, or null once it's gone from the history. */
export async function getClipboardItem(
  id: string,
  app: TinyApp,
): Promise<ClipboardHistoryItem | null> {
  const [row] = all<ClipboardItemRow>(
    await initializeDatabase(app),
    `
      SELECT id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId,
        pinnedAt, pasteAsFile, encrypted, secrets, linkUrl, linkHost,
        ${originMakerColumn}
      FROM "CLIPBOARD_ITEMS"
      WHERE id = ? AND deletedAt IS NULL
    `,
    id,
  );
  if (!row) return null;
  const decrypted = await decryptRow(row, app);
  const { data: dataDirectory } = await appPaths(app);
  const item = decrypted && rowToClipboardItem(decrypted, dataDirectory, false);
  if (!item) return null;
  await readFileSizes([item], app);
  return item;
}

// Only for a single copied file: next to "+N" the first file's size would
// read as the total. Read now, not when copied, since the file may change.
async function readFileSizes(
  items: ClipboardHistoryItem[],
  app: TinyApp,
): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      if (item.paths.length === 1)
        item.fileSize = await getFileSize(item.paths[0], app);
    }),
  );
}

/** The WHERE clause of a list request. A search is matched by sqlite, except
 *  on rows whose text can't be read there: encrypted ones, and ones holding a
 *  masked key, which the search must not find by the key's body. Those pass
 *  here and are checked row by row (needsSearchCheck, matchesSearch). */
function listConditions(
  kind: ClipboardListRequest["kind"],
  search: string,
  cursor?: ClipboardListCursor,
): { where: string; values: unknown[] } {
  // a waiting image is not shown until its file has arrived
  const conditions = [`deletedAt IS NULL`, `NOT ${waitingImage}`];
  const values: unknown[] = [];
  if (kind !== "all") {
    conditions.push(`kind = ?`);
    values.push(kind);
  }
  if (search) {
    const pattern = likePattern(search);
    conditions.push(`(
      encrypted IS 1
      OR value LIKE ? ESCAPE '\\'
      OR path LIKE ? ESCAPE '\\'
      OR sourceAppName LIKE ? ESCAPE '\\'
      OR secrets LIKE ? ESCAPE '\\'
    )`);
    values.push(pattern, pattern, pattern, pattern);
  }
  if (cursor) {
    const after = afterCursor(cursor);
    conditions.push(after.condition);
    values.push(...after.values);
  }
  return { where: conditions.join(" AND "), values };
}

function needsSearchCheck(
  row: Pick<ClipboardItemRow, "encrypted" | "secrets">,
  maskSecrets: boolean,
): boolean {
  return row.encrypted === 1 || (maskSecrets && row.secrets !== null);
}

function toSearchable(row: ClipboardItemRow) {
  return {
    text: row.kind === "text" ? row.value : null,
    secrets: parseSecrets(row.secrets),
    color: row.kind === "color" ? row.value : null,
    paths: parsePaths(row.path),
    sourceAppName: row.sourceAppName,
  };
}

/** How many items a list request matches in all, for the footer. */
async function countClipboardItems(
  app: TinyApp,
  kind: ClipboardListRequest["kind"],
  search: string,
  maskSecrets: boolean,
): Promise<number> {
  const database = await initializeDatabase(app);
  const { where, values } = listConditions(kind, search);
  if (!search) {
    const [result] = all<{ count: number }>(
      database,
      `SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS" WHERE ${where}`,
      ...values,
    );
    return result?.count ?? 0;
  }
  // IS, not =: an unencrypted row has NULL there, and NOT NULL is NULL
  const uncertain = maskSecrets
    ? `(encrypted IS 1 OR secrets IS NOT NULL)`
    : `encrypted IS 1`;
  const [sure] = all<{ count: number }>(
    database,
    `SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS" WHERE ${where} AND NOT ${uncertain}`,
    ...values,
  );
  // the few rows sqlite can't decide are read and checked like the list does
  const uncertainRows = all<ClipboardItemRow>(
    database,
    `SELECT ${listColumns(true)} FROM "CLIPBOARD_ITEMS" WHERE ${where} AND ${uncertain}`,
    textPreviewLength,
    ...values,
  );
  let count = sure?.count ?? 0;
  for (const row of uncertainRows) {
    const decrypted = await decryptRow(row, app);
    if (
      decrypted &&
      matchesSearch(toSearchable(decrypted), search, maskSecrets)
    ) {
      count += 1;
    }
  }
  return count;
}

/** The row with its text decrypted, or null while it can't be: the Keychain
 *  can't be read, or the key there isn't the one it was encrypted with. The
 *  row stays saved, in case the key comes back. */
export async function decryptRow<
  Row extends Pick<ClipboardItemRow, "id" | "value" | "encrypted">,
>(row: Row, app: TinyApp): Promise<Row | null> {
  if (row.encrypted !== 1 || row.value === null) return row;
  try {
    return { ...row, value: await decryptCached(row.id, row.value, app) };
  } catch (error) {
    if (
      !(error instanceof LockedHistoryError) &&
      !(error instanceof HistoryKeychainAccessRequired)
    )
      logError(`decrypting history item ${row.id} failed:`, error);
    return null;
  }
}

// A search counts its matches among every encrypted text, on each keystroke:
// what was decrypted is kept a short while, so typing doesn't decrypt the
// whole history again and again. Keyed by the row and the start of its
// ciphertext, which is its random IV: a text encrypted again never matches.
// Few, and soon let go of: decrypted secrets don't stay in memory for long.
const decryptedCacheSize = 500;
const decryptedCacheMs = 60_000;
const decryptedTexts = new Map<string, string>();
let forgetDecrypted: ReturnType<typeof setTimeout> | undefined;

async function decryptCached(
  id: string,
  encryptedText: string,
  app: TinyApp,
): Promise<string> {
  assertHistoryUnlocked();
  const key = `${id}:${encryptedText.slice(0, 24)}`;
  clearTimeout(forgetDecrypted);
  forgetDecrypted = setTimeout(() => decryptedTexts.clear(), decryptedCacheMs);
  const known = decryptedTexts.get(key);
  if (known !== undefined) {
    // the most recently used last, so the oldest go first
    decryptedTexts.delete(key);
    decryptedTexts.set(key, known);
    return known;
  }
  const text = await decryptText(encryptedText, app);
  assertHistoryUnlocked();
  decryptedTexts.set(key, text);
  if (decryptedTexts.size > decryptedCacheSize) {
    decryptedTexts.delete(decryptedTexts.keys().next().value!);
  }
  return text;
}

/** Forget every decrypted text kept for searching: encryption was turned off,
 *  or its key changed. */
export function forgetDecryptedTexts(): void {
  clearTimeout(forgetDecrypted);
  decryptedTexts.clear();
}

function configureHistoryProtection(
  app: TinyApp,
  envelope: ReturnType<typeof currentHistoryKeyEnvelope>,
  unreadable = false,
): void {
  forgetDecryptedTexts();
  setHistoryKeyEnvelope(
    envelope,
    () => {
      forgetDecryptedTexts();
      app.push(historySecretsLockedEvent);
      app.push(historyProtectionChangedEvent);
      app.push(clipboardHistoryChangedEvent);
    },
    unreadable,
  );
}

async function retireLegacyHistoryKey(app: TinyApp): Promise<void> {
  try {
    await removeLegacyEncryptionKey(app);
  } catch (error) {
    logError("removing the obsolete history key failed:", error);
  }
}

let hardwareAvailable: Promise<boolean> | undefined;

export async function historyProtectionStatus(
  app: TinyApp,
): Promise<HistoryProtectionStatus> {
  await initializeDatabase(app);
  const envelope = currentHistoryKeyEnvelope();
  hardwareAvailable ??= historyHardwareAvailable(app);
  return {
    available: await hardwareAvailable,
    protected: hasHardwareHistoryKey(),
    requireAuthentication: envelope?.requireAuthentication ?? false,
    locked: areHistorySecretsLocked(),
    ...(hasHardwareHistoryKey() && !envelope && { unreadable: true }),
    ...(getSettings().encryptSecrets &&
      needsHistoryKeychainAccess() && {
        needsKeychainAccess: true,
      }),
  };
}

/** Commit new ciphertext and its wrapping metadata together. Never remove
 * the old credential before the verified replacement is durable. */
export async function protectHistorySecrets(
  app: TinyApp,
  requireAuthentication: boolean,
): Promise<void> {
  const database = await initializeDatabase(app);
  await exclusive(async () => {
    if (!getSettings().encryptSecrets)
      throw new Error("Turn on Encrypt secrets first.");
    if (
      currentHistoryKeyEnvelope()?.requireAuthentication ===
      requireAuthentication
    )
      return;
    assertHistoryUnlocked();
    const raw = crypto.getRandomValues(new Uint8Array(32));
    try {
      const envelope = await createVerifiedHistoryKeyEnvelope(
        app,
        raw,
        requireAuthentication,
      );
      const key = await importEncryptionKey(raw);
      const rows = all<{ id: string; value: string }>(
        database,
        `SELECT id, value FROM "CLIPBOARD_ITEMS" WHERE encrypted = 1 AND value IS NOT NULL`,
      );
      if (rows.length && !(await restrictToSavedEncryptionKey(app)))
        throw new Error(
          "The old history key is missing. No entries were changed.",
        );
      const replacement: { id: string; value: string; field?: string }[] = [];
      for (const row of rows) {
        replacement.push({
          id: row.id,
          value: await encryptHistoryText(
            await decryptText(row.value, app),
            key,
          ),
        });
      }
      const plain = all<{ id: string; value: string }>(
        database,
        `SELECT id, value FROM "CLIPBOARD_ITEMS" WHERE kind = 'text' AND encrypted IS NULL AND value IS NOT NULL`,
      );
      for (const row of plain) {
        const found = findSecrets(row.value);
        if (found.length)
          replacement.push({
            id: row.id,
            value: await encryptHistoryText(row.value, key),
            field: serializeSecrets(found)!,
          });
      }
      database.exec("PRAGMA synchronous = FULL");
      try {
        transaction(database, () => {
          for (const row of replacement)
            run(
              database,
              `UPDATE "CLIPBOARD_ITEMS"
               SET value = ?, encrypted = 1, linkUrl = NULL, linkHost = NULL,
                   secrets = coalesce(?, secrets)
               WHERE id = ?`,
              row.value,
              row.field ?? null,
              row.id,
            );
          run(
            database,
            `INSERT OR REPLACE INTO "HISTORY_PROTECTION" (id, envelope) VALUES (1, ?)`,
            JSON.stringify(envelope),
          );
        });
      } finally {
        database.exec("PRAGMA synchronous = NORMAL");
      }
      configureHistoryProtection(app, envelope);
      checkpoint(database);
      await retireLegacyHistoryKey(app);
      if (requireAuthentication) app.push(historySecretsLockedEvent);
      app.push(historyProtectionChangedEvent);
      app.push(clipboardHistoryChangedEvent);
    } finally {
      raw.fill(0);
    }
  });
}

export async function unlockProtectedHistory(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  await exclusive(async () => {
    if (!areHistorySecretsLocked()) return;
    await unlockHistorySecrets(app);
    await encryptPlainSecrets(database, app);
    await refreshDetection(database, app);
    // A peer may have advanced past rows that were temporarily unavailable.
    if (getSettings().syncSecrets)
      restampRows(database, `encrypted = 1 AND deletedAt IS NULL`);
    app.push(historyProtectionChangedEvent);
    notifyClipboardHistoryChanged(app);
  });
}

export function lockProtectedHistory(): void {
  lockHistorySecrets();
}

export async function restoreSecretHistoryAccess(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  await exclusive(async () => {
    if (!getSettings().encryptSecrets || !needsHistoryKeychainAccess()) return;
    const hasRows =
      all(
        database,
        `SELECT 1 FROM "CLIPBOARD_ITEMS" WHERE encrypted = 1 LIMIT 1`,
      ).length > 0;
    await restoreHistoryKeychainAccess(app, hasRows);
    await encryptPlainSecrets(database, app);
    await refreshDetection(database, app);
    if (getSettings().syncSecrets)
      restampRows(database, `encrypted = 1 AND deletedAt IS NULL`);
    app.push(historyProtectionChangedEvent);
    notifyClipboardHistoryChanged(app);
  });
}

/** Encrypt saved text that holds a secret but isn't encrypted yet: copied
 *  while encryption was off or before Teneo looked for secrets, or caught by
 *  a rule added since. Run at startup and when encryption is turned on. */
export async function encryptSecretsInHistory(app: TinyApp): Promise<void> {
  if (areHistorySecretsLocked() || needsHistoryKeychainAccess()) return;
  const database = await initializeDatabase(app);
  await exclusive(() => encryptPlainSecrets(database, app));
}

async function encryptPlainSecrets(
  database: Database,
  app: TinyApp,
): Promise<void> {
  const rows = all<Pick<ClipboardItemRow, "id" | "value">>(
    database,
    `
      SELECT id, value FROM "CLIPBOARD_ITEMS"
      WHERE kind = 'text' AND encrypted IS NULL AND value IS NOT NULL
    `,
  );
  // encrypted first, written after in one transaction: stopped midway, the
  // history is as it was rather than half encrypted
  const encrypted: { id: string; value: string }[] = [];
  for (const { id, value } of rows) {
    if (!value || findSecrets(value).length === 0) continue;
    encrypted.push({ id, value: await encryptText(value, app) });
  }
  if (encrypted.length === 0) return;
  transaction(database, () => {
    for (const { id, value } of encrypted) {
      run(
        database,
        `UPDATE "CLIPBOARD_ITEMS" SET value = ?, encrypted = 1
             ${currentHistoryKeyEnvelope() ? ", linkUrl = NULL, linkHost = NULL" : ""}
         WHERE id = ? AND encrypted IS NULL`,
        value,
        id,
      );
    }
  });
  // the plain keys are gone from the file (secure_delete); this takes them
  // out of the write-ahead log too
  checkpoint(database);
}

/** Turn "Encrypt API keys" on: get the Keychain key first, so a denied
 *  Keychain leaves it off, then encrypt the keys already in history. */
export async function turnOnSecretEncryption(app: TinyApp): Promise<boolean> {
  const database = await initializeDatabase(app);
  return exclusive(async () => {
    try {
      await prepareEncryptionKey(app);
    } catch (error) {
      logError("reading the encryption key failed:", error);
      return false;
    }
    await updateSettings({ encryptSecrets: true }, app);
    await encryptPlainSecrets(database, app);
    return true;
  });
}

/** Turn "Encrypt API keys" off: save the keys in history as plain text and
 *  delete the Keychain key. Items that key can't decrypt could never be read
 *  again, so they're deleted, as the user would delete them: other devices
 *  hear of it. False, and still on, when the Keychain can't be read:
 *  decrypting needs the key. The setting and the key change only after the
 *  history has, so a stop midway leaves encryption on, as it was. */
export async function turnOffSecretEncryption(app: TinyApp): Promise<boolean> {
  const database = await initializeDatabase(app);
  return exclusive(async () => {
    const hardware = hasHardwareHistoryKey();
    let hasKey: boolean;
    try {
      hasKey = await restrictToSavedEncryptionKey(app);
      await decryptEncryptedRows(database, app, hasKey, hardware);
    } catch (error) {
      if (!(error instanceof LockedHistoryError))
        logError("reading the encryption key failed:", error);
      return false;
    }
    await updateSettings({ encryptSecrets: false }, app);
    if (hardware) {
      run(database, `DELETE FROM "HISTORY_PROTECTION" WHERE id = 1`);
      configureHistoryProtection(app, null);
      app.push(historyProtectionChangedEvent);
    } else {
      forgetDecryptedTexts();
      if (hasKey) await deleteEncryptionKey(app);
    }
    return true;
  });
}

async function decryptEncryptedRows(
  database: Database,
  app: TinyApp,
  hasKey: boolean,
  preserveUnreadable = false,
): Promise<void> {
  const rows = all<Pick<ClipboardItemRow, "id" | "value">>(
    database,
    `SELECT id, value FROM "CLIPBOARD_ITEMS" WHERE encrypted = 1`,
  );
  // All decrypted first, then written in one transaction: a failure or a
  // crash midway changes nothing. The key is read once (restrict...), so a
  // row it can't decrypt was encrypted with another key, and can't be read
  // on a second try either.
  const decrypted: { id: string; plaintext: string | null }[] = [];
  for (const { id, value } of rows) {
    decrypted.push({
      id,
      plaintext:
        hasKey && value !== null
          ? await decryptText(value, app).catch((error) => {
              if (preserveUnreadable) throw error;
              return null;
            })
          : null,
    });
  }
  transaction(database, () => {
    for (const { id, plaintext } of decrypted) {
      if (plaintext === null) {
        // a delete like the user's: a tombstone, never a row that vanishes
        // from under the other devices
        run(
          database,
          `
            UPDATE "CLIPBOARD_ITEMS"
            SET deletedAt = ifnull(deletedAt, ?), pinnedAt = NULL, syncSeq = ?, ${eraseText}
            WHERE id = ? AND encrypted = 1
          `,
          Date.now(),
          nextSyncSeq(database),
          id,
        );
      } else {
        run(
          database,
          `UPDATE "CLIPBOARD_ITEMS" SET value = ?, encrypted = NULL WHERE id = ? AND encrypted = 1`,
          plaintext,
          id,
        );
      }
    }
  });
  if (rows.length) notifyClipboardHistoryChanged(app);
}

/** Earlier versions always encrypted keys. When this one first starts with
 *  encrypted items in history, encryption stays on for them. */
export async function keepEncryptionFromEarlierVersion(
  app: TinyApp,
): Promise<void> {
  const database = await initializeDatabase(app);
  if (hasHardwareHistoryKey()) {
    if (!getSettings().encryptSecrets)
      await updateSettings({ encryptSecrets: true }, app);
    return;
  }
  if (await isSettingSaved("encryptSecrets", app)) return;
  const [result] = all<{ count: number }>(
    database,
    `SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS" WHERE encrypted = 1`,
  );
  if ((result?.count ?? 0) > 0) {
    await updateSettings({ encryptSecrets: true }, app);
  }
}

function serializeImageSize(item: TinyClipboardData): string | null {
  return item.kind === "image" && item.imageSize
    ? JSON.stringify(item.imageSize)
    : null;
}

function serializePath(
  item: TinyClipboardData,
  dataDirectory: string,
): string | null {
  if (item.kind === "image") {
    if (!item.image) return null;
    const prefix = `${dataDirectory}/`;
    if (!item.image.startsWith(prefix)) {
      throw new Error(
        "Clipboard image was not saved to the app data directory",
      );
    }
    return item.image.slice(prefix.length);
  }

  return item.kind === "files" ? JSON.stringify(item.paths) : null;
}

function serializeValue(item: TinyClipboardData): string | null {
  if (item.kind === "text") return item.text;
  if (item.kind === "color") return item.color;
  return null;
}

// Columns added after the first release; older databases lack them
const addedColumns = {
  sourceAppName: "TEXT",
  sourceAppBundleId: "TEXT",
  deletedAt: "INTEGER",
  pinnedAt: "INTEGER",
  pasteAsFile: "INTEGER",
  encrypted: "INTEGER",
  secrets: "TEXT",
  linkUrl: "TEXT",
  linkHost: "TEXT",
  detectorVersion: "INTEGER",
  // for sync: the row's place in this device's change counter, the stamp of
  // its latest pin or unpin, the device that first copied it, and when
  syncSeq: "INTEGER",
  pinnedStamp: "TEXT",
  originDevice: "TEXT",
  createdAt: "INTEGER",
  // for syncing an image: the SHA-256 of its file, the file's length and its
  // kind ("image/png"). Filled in the first time the image is sent, and from
  // the record for one that arrives.
  imageHash: "TEXT",
  imageBytes: "INTEGER",
  imageType: "TEXT",
};

// What the storage limit reads of each row, in a table of its own: reading
// the history table, sqlite steps through a long text's pages to reach the
// columns stored after it (dateCopied among them), on every copy. Kept by
// triggers on every write, whoever makes it (a copy, sync, encryption, a
// delete); the byte count is worked out only when a text or a path is.
const itemBytes = (row: string) =>
  `ifnull(length(CAST(${row}.value AS BLOB)), 0) + ifnull(length(CAST(${row}.path AS BLOB)), 0)`;

function keepItemSizes(database: Database): void {
  database.exec(`
    DROP TRIGGER IF EXISTS clipboard_items_row_bytes_insert;
    DROP TRIGGER IF EXISTS clipboard_items_row_bytes_update;
    CREATE TABLE IF NOT EXISTS "CLIPBOARD_ITEM_SIZES" (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      imagePath TEXT,
      dateCopied INTEGER NOT NULL,
      pinned INTEGER NOT NULL,
      deletedAt INTEGER,
      hasValue INTEGER NOT NULL,
      hasPath INTEGER NOT NULL,
      bytes INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS clipboard_item_sizes_order_index
      ON "CLIPBOARD_ITEM_SIZES" (dateCopied DESC, id DESC);
    CREATE TRIGGER IF NOT EXISTS clipboard_item_sizes_insert
    AFTER INSERT ON "CLIPBOARD_ITEMS" BEGIN
      INSERT OR REPLACE INTO "CLIPBOARD_ITEM_SIZES" VALUES (
        NEW.id, NEW.kind, CASE WHEN NEW.kind = 'image' THEN NEW.path END,
        NEW.dateCopied, NEW.pinnedAt IS NOT NULL, NEW.deletedAt,
        NEW.value IS NOT NULL, NEW.path IS NOT NULL, ${itemBytes("NEW")}
      );
    END;
    CREATE TRIGGER IF NOT EXISTS clipboard_item_sizes_contents
    AFTER UPDATE OF value, path ON "CLIPBOARD_ITEMS" BEGIN
      UPDATE "CLIPBOARD_ITEM_SIZES" SET
        imagePath = CASE WHEN NEW.kind = 'image' THEN NEW.path END,
        hasValue = NEW.value IS NOT NULL, hasPath = NEW.path IS NOT NULL,
        bytes = ${itemBytes("NEW")}
      WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS clipboard_item_sizes_state
    AFTER UPDATE OF kind, dateCopied, pinnedAt, deletedAt ON "CLIPBOARD_ITEMS" BEGIN
      UPDATE "CLIPBOARD_ITEM_SIZES" SET
        kind = NEW.kind, dateCopied = NEW.dateCopied,
        pinned = NEW.pinnedAt IS NOT NULL, deletedAt = NEW.deletedAt
      WHERE id = NEW.id;
    END;
    CREATE TRIGGER IF NOT EXISTS clipboard_item_sizes_delete
    AFTER DELETE ON "CLIPBOARD_ITEMS" BEGIN
      DELETE FROM "CLIPBOARD_ITEM_SIZES" WHERE id = OLD.id;
    END;
  `);
  // once, for the rows from before the table
  run(
    database,
    `
      INSERT OR IGNORE INTO "CLIPBOARD_ITEM_SIZES"
      SELECT id, kind, CASE WHEN kind = 'image' THEN path END, dateCopied,
        pinnedAt IS NOT NULL, deletedAt, value IS NOT NULL, path IS NOT NULL,
        ${itemBytes('"CLIPBOARD_ITEMS"')}
      FROM "CLIPBOARD_ITEMS"
      WHERE id NOT IN (SELECT id FROM "CLIPBOARD_ITEM_SIZES")
    `,
  );
}

function addMissingColumns(database: Database): void {
  const columnNames = new Set(
    all<ClipboardItemColumn>(
      database,
      `PRAGMA table_info("CLIPBOARD_ITEMS")`,
    ).map((column) => column.name),
  );
  for (const [name, type] of Object.entries(addedColumns)) {
    if (!columnNames.has(name)) {
      run(database, `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN ${name} ${type}`);
    }
  }
}

/** The item a row holds; `preview` cuts a long text down for the list. */
function rowToClipboardItem(
  row: ClipboardItemRow,
  dataDirectory: string,
  preview: boolean,
): ClipboardHistoryItem | null {
  if (!isClipboardItemKind(row.kind) || !isValidDate(row.dateCopied)) {
    return null;
  }

  const isText = row.kind === "text";
  const fullText = isText ? row.value : null;
  const secrets = isText ? parseSecrets(row.secrets) : [];
  const text =
    preview && fullText !== null
      ? truncateTextPreview(
          fullText,
          secrets,
          // sqlite's length is of the plain text, not of a ciphertext
          row.encrypted === 1
            ? fullText.length
            : (row.valueLength ?? fullText.length),
        )
      : { text: fullText, secrets, isTruncated: false };

  return {
    id: row.id,
    dateCopied: row.dateCopied,
    kind: row.kind,
    changeCount: row.dateCopied,
    text: text.text,
    html: null,
    paths: row.kind === "files" ? parsePaths(row.path) : [],
    image:
      row.kind === "image" ? restoreImagePath(row.path, dataDirectory) : null,
    imageSize: row.kind === "image" ? parseImageSize(row.imageSize) : null,
    color: row.kind === "color" ? row.value : null,
    concealed: false,
    sourceApp: sourceAppFromRow(row),
    originMaker: row.originMaker || null,
    sourceURL: null,
    pinned: row.pinnedAt != null,
    pasteAsFile: row.kind === "image" && row.pasteAsFile === 1,
    fileSize: null, // filled in by readFileSizes
    secrets: text.secrets,
    link:
      isText && row.linkUrl && row.linkHost
        ? { url: row.linkUrl, host: row.linkHost }
        : null,
    isTruncated: text.isTruncated,
  };
}

function sourceAppFromRow(
  row: ClipboardItemRow,
): ClipboardHistoryItem["sourceApp"] {
  if (row.sourceAppName == null && row.sourceAppBundleId == null) return null;
  return {
    name: row.sourceAppName,
    bundleId: row.sourceAppBundleId,
  };
}

function isClipboardItemKind(value: string): value is ClipboardItemKind {
  return (
    value === "text" ||
    value === "image" ||
    value === "files" ||
    value === "color"
  );
}

function isValidDate(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function restoreImagePath(
  path: string | null,
  dataDirectory: string,
): string | null {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return `${dataDirectory}/${path}`;
}

function parsePaths(path: string | null): string[] {
  if (!path) return [];
  try {
    const paths: unknown = JSON.parse(path);
    return Array.isArray(paths) &&
      paths.every((item) => typeof item === "string")
      ? paths
      : [];
  } catch {
    return [];
  }
}

function parseImageSize(
  imageSize: string | null,
): { width: number; height: number } | null {
  if (!imageSize) return null;
  try {
    const parsed: unknown = JSON.parse(imageSize);
    if (!parsed || typeof parsed !== "object") return null;
    const { width, height } = parsed as Record<string, unknown>;
    return typeof width === "number" && typeof height === "number"
      ? { width, height }
      : null;
  } catch {
    return null;
  }
}
