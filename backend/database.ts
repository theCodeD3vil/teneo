import { Database } from "tjs:sqlite";

import type {
  ClipboardHistoryItem,
  ClipboardItemColumn,
  ClipboardItemKind,
  ClipboardItemRow,
} from "./types/clipboard";
import { generateUUID } from "./utils/uuid-generatoe";

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
        sourceAppBundleId TEXT
      )
    `,
  );
  addSourceAppColumns(database);
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
  item: TinyClipboardData,
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
  };

  run(
    await initializeDatabase(app),
    `
      INSERT INTO "CLIPBOARD_ITEMS" (
        id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    savedItem.id,
    savedItem.kind,
    serializeImageSize(savedItem),
    serializePath(savedItem, app),
    serializeValue(savedItem),
    savedItem.dateCopied,
    savedItem.sourceApp?.name ?? null,
    savedItem.sourceApp?.bundleId ?? null,
  );

  return savedItem;
}

export async function listClipboardItems(
  app: TinyApp,
): Promise<ClipboardHistoryItem[]> {
  const rows = all<ClipboardItemRow>(
    await initializeDatabase(app),
    `
      SELECT id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId
      FROM "CLIPBOARD_ITEMS"
      ORDER BY dateCopied DESC
    `,
  );

  return rows.flatMap((row) => {
    const item = rowToClipboardItem(row, app);
    return item ? [item] : [];
  });
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

function addSourceAppColumns(database: Database): void {
  const columnNames = new Set(
    all<ClipboardItemColumn>(
      database,
      `PRAGMA table_info("CLIPBOARD_ITEMS")`,
    ).map((column) => column.name),
  );
  if (!columnNames.has("sourceAppName")) {
    run(
      database,
      `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN sourceAppName TEXT`,
    );
  }
  if (!columnNames.has("sourceAppBundleId")) {
    run(
      database,
      `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN sourceAppBundleId TEXT`,
    );
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

function all<T>(database: Database, query: string): T[] {
  const statement = database.prepare(query);
  try {
    return statement.all() as T[];
  } finally {
    statement.finalize();
  }
}
