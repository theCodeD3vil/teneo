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
  afterCursor,
  likePattern,
  matchesSearch,
  pageOrder,
  truncateTextPreview,
} from "./history-query";
import { findLink } from "./link-previews";
import { appPaths } from "./paths";
import { findSecrets } from "./secret-detection";
import {
  decryptText,
  deleteEncryptionKey,
  encryptText,
  prepareEncryptionKey,
  restrictToSavedEncryptionKey,
} from "./secret-encryption";
import { getSettings, isSettingSaved, updateSettings } from "./settings";
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

// Secrets and links are found once, when a text is copied, and stored with
// it. Bump this when findSecrets or findLink changes: at the next start every
// older text is looked at again (see refreshDetectionMetadata).
const detectionVersion = 1;

export function initializeDatabase(app: TinyApp): Promise<Database> {
  databasePromise ??= openDatabase(app);
  return databasePromise;
}

async function openDatabase(app: TinyApp): Promise<Database> {
  const { data } = await appPaths(app); // already created by the time it resolves
  const database = new Database(`${data}/teneo.sqlite`);
  // WAL: listing a page while a copy is saved doesn't wait for the save, and
  // a save doesn't wait for the disk to sync (NORMAL is still safe against a
  // crash). The timeout covers a second process holding the file briefly.
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
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
  createIndexes(database);

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
  const isEncrypted =
    getSettings().encryptSecrets &&
    value !== null &&
    savedItem.secrets.length > 0;
  const database = await initializeDatabase(app);
  const repeated = await findRepeatCopy(savedItem, database, app);
  if (repeated) {
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS"
        SET dateCopied = ?, sourceAppName = ?, sourceAppBundleId = ?
        WHERE id = ?
      `,
      dateCopied,
      savedItem.sourceApp?.name ?? null,
      savedItem.sourceApp?.bundleId ?? null,
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
        secrets, linkUrl, linkHost, detectorVersion
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    savedItem.link?.url ?? null,
    savedItem.link?.host ?? null,
    detectionVersion,
  );
  notifyClipboardHistoryChanged(app);

  return savedItem;
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

function detectInText(text: string | null): {
  secrets: SecretSpan[];
  link: ClipboardLink | null;
} {
  if (!text) return { secrets: [], link: null };
  return { secrets: findSecrets(text), link: findLink(text) };
}

function serializeSecrets(secrets: SecretSpan[]): string | null {
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
    run(
      database,
      `
        UPDATE "CLIPBOARD_ITEMS"
        SET secrets = ?, linkUrl = ?, linkHost = ?, detectorVersion = ?
        WHERE id = ?
      `,
      serializeSecrets(secrets),
      link?.url ?? null,
      link?.host ?? null,
      detectionVersion,
      row.id,
    );
    changed = true;
  }
  if (changed) notifyClipboardHistoryChanged(app);
}

// Matches unpinned items copied before ?1 (ms) or beyond the newest ?2
// unpinned ones (-1 = no limit). Pinned items are never deleted or counted.
const deletionCondition = `
  pinnedAt IS NULL AND (dateCopied < ? OR id NOT IN (
    SELECT id FROM "CLIPBOARD_ITEMS" WHERE pinnedAt IS NULL
    ORDER BY dateCopied DESC LIMIT ?
  ))
`;

/** Whether these limits can delete anything. With none set (the default)
 *  deletionCondition matches nothing, but checking it after every copy would
 *  still read the whole history for its NOT IN. */
function limitsHistory(copiedBefore: number, keepNewest: number): boolean {
  return copiedBefore > 0 || keepNewest >= 0;
}

/** How many items in the history deleteClipboardItems would delete with
 *  these limits. Already-deleted items still get removed, but aren't counted. */
export async function countClipboardItemsToDelete(
  app: TinyApp,
  copiedBefore: number,
  keepNewest: number,
): Promise<number> {
  if (!limitsHistory(copiedBefore, keepNewest)) return 0;
  const [result] = all<{ count: number }>(
    await initializeDatabase(app),
    `
      SELECT COUNT(*) AS count FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL AND (${deletionCondition})
    `,
    copiedBefore,
    keepNewest,
  );
  return result?.count ?? 0;
}

/** Delete items copied before `copiedBefore` (ms) or beyond the newest
 *  `keepNewest` (-1 = no limit), along with their saved images. */
export async function deleteClipboardItems(
  app: TinyApp,
  copiedBefore: number,
  keepNewest: number,
): Promise<void> {
  if (!limitsHistory(copiedBefore, keepNewest)) return;
  const database = await initializeDatabase(app);
  // Read and delete with no await in between (sqlite is sync), so an item
  // saved meanwhile can't be deleted without its image path being read
  const deletedRows = all<Pick<ClipboardItemRow, "kind" | "path">>(
    database,
    `SELECT kind, path FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
    copiedBefore,
    keepNewest,
  );
  if (deletedRows.length === 0) return;
  run(
    database,
    `DELETE FROM "CLIPBOARD_ITEMS" WHERE ${deletionCondition}`,
    copiedBefore,
    keepNewest,
  );
  notifyClipboardHistoryChanged(app);

  // Images go after their rows, so history never points at a missing file
  const { data: dataDirectory } = await appPaths(app);
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

/** Hide an item from the history but keep its row and image, so it can be
 *  restored. It's unpinned too, so history limits count it and delete it in time. */
export async function softDeleteClipboardItem(
  id: string,
  app: TinyApp,
): Promise<void> {
  run(
    await initializeDatabase(app),
    `
      UPDATE "CLIPBOARD_ITEMS" SET deletedAt = ?, pinnedAt = NULL
      WHERE id = ? AND deletedAt IS NULL
    `,
    Date.now(),
    id,
  );
  notifyClipboardHistoryChanged(app);
}

/** Pinned items list first, newest pin first, and history
 *  limits leave them alone. */
export async function setClipboardItemPinned(
  id: string,
  pinned: boolean,
  app: TinyApp,
): Promise<void> {
  run(
    await initializeDatabase(app),
    `UPDATE "CLIPBOARD_ITEMS" SET pinnedAt = ? WHERE id = ? AND deletedAt IS NULL`,
    pinned ? Date.now() : null,
    id,
  );
  notifyClipboardHistoryChanged(app);
}

// A saved image never changes, so it is measured once instead of on every
// copy that applies the storage limit
let imageSizes = new Map<string, number>();

/** Bytes each history item takes, newest first: its text, color or file
 *  list, plus its saved image. The storage limit counts the unpinned ones. */
export async function listClipboardItemSizes(
  app: TinyApp,
): Promise<Array<{ kind: string; bytes: number; pinned: boolean }>> {
  const rows = all<
    Pick<ClipboardItemRow, "kind" | "path" | "pinnedAt"> & { rowBytes: number }
  >(
    await initializeDatabase(app),
    `
      SELECT kind, path, pinnedAt,
        ifnull(length(CAST(value AS BLOB)), 0) +
        ifnull(length(CAST(path AS BLOB)), 0) AS rowBytes
      FROM "CLIPBOARD_ITEMS"
      ORDER BY dateCopied DESC
    `,
  );
  const { data: dataDirectory } = await appPaths(app);
  const measuredImages = new Map<string, number>();
  const sizes = await Promise.all(
    rows.map(async (row) => {
      const imagePath =
        row.kind === "image" ? restoreImagePath(row.path, dataDirectory) : null;
      // a missing image file takes no space
      let imageBytes = 0;
      if (imagePath) {
        const bytes =
          imageSizes.get(imagePath) ??
          (await tjs.stat(imagePath).then(
            (stat: { size: number }) => stat.size,
            () => undefined,
          ));
        if (bytes !== undefined) {
          measuredImages.set(imagePath, bytes);
          imageBytes = bytes;
        }
      }
      return {
        kind: row.kind,
        bytes: row.rowBytes + imageBytes,
        pinned: row.pinnedAt != null,
      };
    }),
  );
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
        COUNT(*) FILTER (WHERE kind = 'image') AS imageCount,
        SUM(CASE WHEN kind = 'files' THEN json_array_length(path) END) AS fileCount
      FROM "CLIPBOARD_ITEMS"
    `,
  );
  return {
    imageCount: counts?.imageCount ?? 0,
    fileCount: counts?.fileCount ?? 0,
  };
}

/** Call after every committed clipboard-history insert, update, or deletion. */
export function notifyClipboardHistoryChanged(app: TinyApp): void {
  app.push(clipboardHistoryChangedEvent);
}

// The list reads only the start of a long text: the card shows two lines, and
// the whole text comes by id when it's previewed or copied. A text holding a
// secret is read whole, so the search can tell the secret from the rest.
const listColumns = `
  id, kind, imageSize, path, dateCopied, sourceAppName, sourceAppBundleId,
  pinnedAt, pasteAsFile, encrypted, secrets, linkUrl, linkHost,
  CASE WHEN kind != 'text' OR encrypted IS 1 OR secrets IS NOT NULL
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
        SELECT ${listColumns} FROM "CLIPBOARD_ITEMS"
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

  await readFileSizes(items);
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
        pinnedAt, pasteAsFile, encrypted, secrets, linkUrl, linkHost
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
  await readFileSizes([item]);
  return item;
}

// Only for a single copied file: next to "+N" the first file's size would
// read as the total. Read now, not when copied, since the file may change.
async function readFileSizes(items: ClipboardHistoryItem[]): Promise<void> {
  await Promise.all(
    items.map(async (item) => {
      if (item.paths.length === 1)
        item.fileSize = await getFileSize(item.paths[0]);
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
  const conditions = [`deletedAt IS NULL`];
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
    `SELECT ${listColumns} FROM "CLIPBOARD_ITEMS" WHERE ${where} AND ${uncertain}`,
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
async function decryptRow<
  Row extends Pick<ClipboardItemRow, "id" | "value" | "encrypted">,
>(row: Row, app: TinyApp): Promise<Row | null> {
  if (row.encrypted !== 1 || row.value === null) return row;
  try {
    return { ...row, value: await decryptText(row.value, app) };
  } catch (error) {
    logError(`decrypting history item ${row.id} failed:`, error);
    return null;
  }
}

/** Encrypt saved text that holds a secret but isn't encrypted yet: copied
 *  while encryption was off or before Teneo looked for secrets, or caught by
 *  a rule added since. Run at startup and when encryption is turned on. */
export async function encryptSecretsInHistory(app: TinyApp): Promise<void> {
  const database = await initializeDatabase(app);
  const rows = all<Pick<ClipboardItemRow, "id" | "value">>(
    database,
    `
      SELECT id, value FROM "CLIPBOARD_ITEMS"
      WHERE kind = 'text' AND encrypted IS NULL AND value IS NOT NULL
    `,
  );
  for (const { id, value } of rows) {
    if (!value || findSecrets(value).length === 0) continue;
    run(
      database,
      `UPDATE "CLIPBOARD_ITEMS" SET value = ?, encrypted = 1 WHERE id = ? AND encrypted IS NULL`,
      await encryptText(value, app),
      id,
    );
  }
}

/** Turn "Encrypt API keys" on: get the Keychain key first, so a denied
 *  Keychain leaves it off, then encrypt the keys already in history. */
export async function turnOnSecretEncryption(app: TinyApp): Promise<boolean> {
  try {
    await prepareEncryptionKey(app);
  } catch (error) {
    logError("reading the encryption key failed:", error);
    return false;
  }
  await updateSettings({ encryptSecrets: true }, app);
  await encryptSecretsInHistory(app);
  return true;
}

/** Turn "Encrypt API keys" off: save the keys in history as plain text and
 *  delete the Keychain key. Items that key can't decrypt could never be read
 *  again, so they're deleted. False, and still on, when the Keychain can't be
 *  read: decrypting needs the key. */
export async function turnOffSecretEncryption(app: TinyApp): Promise<boolean> {
  let hasKey: boolean;
  try {
    hasKey = await restrictToSavedEncryptionKey(app);
  } catch (error) {
    logError("reading the encryption key failed:", error);
    return false;
  }

  const database = await initializeDatabase(app);
  const rows = all<Pick<ClipboardItemRow, "id" | "value">>(
    database,
    `SELECT id, value FROM "CLIPBOARD_ITEMS" WHERE encrypted = 1`,
  );
  for (const { id, value } of rows) {
    const plaintext =
      hasKey && value !== null
        ? await decryptText(value, app).catch(() => null)
        : null;
    if (plaintext === null) {
      run(database, `DELETE FROM "CLIPBOARD_ITEMS" WHERE id = ?`, id);
    } else {
      run(
        database,
        `UPDATE "CLIPBOARD_ITEMS" SET value = ?, encrypted = NULL WHERE id = ?`,
        plaintext,
        id,
      );
    }
  }
  if (rows.length) notifyClipboardHistoryChanged(app);

  await updateSettings({ encryptSecrets: false }, app);
  if (hasKey) await deleteEncryptionKey(app);
  return true;
}

/** Earlier versions always encrypted keys. When this one first starts with
 *  encrypted items in history, encryption stays on for them. */
export async function keepEncryptionFromEarlierVersion(
  app: TinyApp,
): Promise<void> {
  if (await isSettingSaved("encryptSecrets", app)) return;
  const [result] = all<{ count: number }>(
    await initializeDatabase(app),
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
};

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

function run(database: Database, query: string, ...values: unknown[]): void {
  const statement = database.prepare(query);
  try {
    statement.run(...values);
  } finally {
    statement.finalize();
  }
}

function all<T>(database: Database, query: string, ...values: unknown[]): T[] {
  const statement = database.prepare(query);
  try {
    return statement.all(...values) as T[];
  } finally {
    statement.finalize();
  }
}
