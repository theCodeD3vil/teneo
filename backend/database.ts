import { Database } from "tjs:sqlite";

import { getFileSize } from "./file-previews";
import { logError } from "./files";
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

async function openDatabase(app: TinyApp): Promise<Database> {
  await tjs.makeDir(app.paths.data, { recursive: true });

  const database = new Database(`${app.paths.data}/teneo.sqlite`);
  run(
    database,
    `
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
        pasteAsFile INTEGER
      )
    `,
  );
  addMissingColumns(database);
  run(
    database,
    `
      CREATE INDEX IF NOT EXISTS clipboard_items_date_copied_index
      ON "CLIPBOARD_ITEMS" (dateCopied DESC)
    `,
  );

  return database;
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
    id: generateUUID(),
    dateCopied,
    pinned: false,
    pasteAsFile: item.pasteAsFile === true,
    fileSize: null, // read when history is listed
  };

  run(
    await initializeDatabase(app),
    `
      INSERT INTO "CLIPBOARD_ITEMS" (
        id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId, pasteAsFile
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    savedItem.id,
    savedItem.kind,
    serializeImageSize(savedItem),
    serializePath(savedItem, app),
    serializeValue(savedItem),
    savedItem.dateCopied,
    savedItem.sourceApp?.name ?? null,
    savedItem.sourceApp?.bundleId ?? null,
    savedItem.pasteAsFile ? 1 : null,
  );
  notifyClipboardHistoryChanged(app);

  return savedItem;
}

// Matches unpinned items copied before ?1 (ms) or beyond the newest ?2
// unpinned ones (-1 = no limit). Pinned items are never deleted or counted.
const deletionCondition = `
  pinnedAt IS NULL AND (dateCopied < ? OR id NOT IN (
    SELECT id FROM "CLIPBOARD_ITEMS" WHERE pinnedAt IS NULL
    ORDER BY dateCopied DESC LIMIT ?
  ))
`;

/** How many items in the history deleteClipboardItems would delete with
 *  these limits. Already-deleted items still get removed, but aren't counted. */
export async function countClipboardItemsToDelete(
  app: TinyApp,
  copiedBefore: number,
  keepNewest: number,
): Promise<number> {
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
  for (const row of deletedRows) {
    const imagePath =
      row.kind === "image" ? restoreImagePath(row.path, app) : null;
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
  return Promise.all(
    rows.map(async (row) => {
      const imagePath =
        row.kind === "image" ? restoreImagePath(row.path, app) : null;
      // a missing image file takes no space
      const imageBytes = imagePath
        ? await tjs.stat(imagePath).then(
            (stat: { size: number }) => stat.size,
            () => 0,
          )
        : 0;
      return {
        kind: row.kind,
        bytes: row.rowBytes + imageBytes,
        pinned: row.pinnedAt != null,
      };
    }),
  );
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

export async function listClipboardItems(
  app: TinyApp,
): Promise<ClipboardHistoryItem[]> {
  const rows = all<ClipboardItemRow>(
    await initializeDatabase(app),
    `
      SELECT id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, pasteAsFile
      FROM "CLIPBOARD_ITEMS"
      WHERE deletedAt IS NULL
      ORDER BY pinnedAt IS NULL, pinnedAt DESC, dateCopied DESC
    `,
  );

  const items = rows.flatMap((row) => {
    const item = rowToClipboardItem(row, app);
    return item ? [item] : [];
  });
  // Only for a single copied file: next to "+N" the first file's size would
  // read as the total. Read now, not when copied, since the file may change.
  await Promise.all(
    items.map(async (item) => {
      if (item.paths.length === 1)
        item.fileSize = await getFileSize(item.paths[0]);
    }),
  );
  return items;
}

function serializeImageSize(item: TinyClipboardData): string | null {
  return item.kind === "image" && item.imageSize
    ? JSON.stringify(item.imageSize)
    : null;
}

function serializePath(item: TinyClipboardData, app: TinyApp): string | null {
  if (item.kind === "image") {
    if (!item.image) return null;
    const dataDirectory = `${app.paths.data}/`;
    if (!item.image.startsWith(dataDirectory)) {
      throw new Error(
        "Clipboard image was not saved to the app data directory",
      );
    }
    return item.image.slice(dataDirectory.length);
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

function rowToClipboardItem(
  row: ClipboardItemRow,
  app: TinyApp,
): ClipboardHistoryItem | null {
  if (!isClipboardItemKind(row.kind) || !isValidDate(row.dateCopied)) {
    return null;
  }

  return {
    id: row.id,
    dateCopied: row.dateCopied,
    kind: row.kind,
    changeCount: row.dateCopied,
    text: row.kind === "text" ? row.value : null,
    html: null,
    paths: row.kind === "files" ? parsePaths(row.path) : [],
    image: row.kind === "image" ? restoreImagePath(row.path, app) : null,
    imageSize: row.kind === "image" ? parseImageSize(row.imageSize) : null,
    color: row.kind === "color" ? row.value : null,
    concealed: false,
    sourceApp: sourceAppFromRow(row),
    sourceURL: null,
    pinned: row.pinnedAt != null,
    pasteAsFile: row.kind === "image" && row.pasteAsFile === 1,
    fileSize: null, // filled in by listClipboardItems
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

function restoreImagePath(path: string | null, app: TinyApp): string | null {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return `${app.paths.data}/${path}`;
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
