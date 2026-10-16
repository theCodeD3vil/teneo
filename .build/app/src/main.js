// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/files.ts
async function fileExists(path) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}
async function dataFolder(app, name) {
  const folder = `${app.paths.data}/${name}`;
  await tjs.makeDir(folder, { recursive: true });
  return folder;
}
async function pngDataUrl(path) {
  const png = await tjs.readFile(path);
  return `data:image/png;base64,${png.toBase64()}`;
}
function logError(message, error) {
  console.error(message, error);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/run-command.ts
async function runCommand(command) {
  try {
    const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
    const reader = child.stdout.getReader();
    const textDecoder = new TextDecoder();
    let output = "";
    for (; ; ) {
      const { value, done } = await reader.read();
      if (done) break;
      output += textDecoder.decode(value, { stream: true });
    }
    output += textDecoder.decode();
    const exit = await child.wait();
    return exit.exit_status === 0 ? output.trim() : "";
  } catch (error) {
    logError(`${command[0]} failed to run:`, error);
    return "";
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/find-app.ts
var APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`
];
var installedApps;
async function findAppPath(bundleId) {
  return await findAppWithSpotlight(bundleId) ?? (await getInstalledApps()).get(bundleId);
}
async function findAppWithSpotlight(bundleId) {
  const results = await runCommand([
    "/usr/bin/mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`
  ]);
  const appPath = results.split("\n").find((path) => path.endsWith(".app"));
  return appPath && await fileExists(appPath) ? appPath : void 0;
}
function getInstalledApps() {
  installedApps ??= scanAllFolders().catch((error) => {
    installedApps = void 0;
    throw error;
  });
  return installedApps;
}
async function scanAllFolders() {
  const apps = /* @__PURE__ */ new Map();
  for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
  return apps;
}
async function scanFolderForApps(folder, apps, subfolderDepth) {
  let entries;
  try {
    entries = await tjs.readDir(folder);
  } catch {
    return;
  }
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (entry.name.endsWith(".app")) {
      const bundleId = await readBundleId(path);
      if (bundleId && !apps.has(bundleId)) apps.set(bundleId, path);
    } else if (entry.isDirectory && subfolderDepth > 0) {
      await scanFolderForApps(path, apps, subfolderDepth - 1);
    }
  }
}
function readBundleId(appPath) {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`
  ]);
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/app-icons.ts
var ICON_SIZE = 32;
var BUNDLE_ID_PATTERN = /^[\w.-]+$/;
var iconUrls = /* @__PURE__ */ new Map();
async function saveAppIcon(bundleId, app) {
  if (!BUNDLE_ID_PATTERN.test(bundleId)) return null;
  const iconPath = `${await dataFolder(app, "icons")}/${bundleId}.png`;
  if (await fileExists(iconPath)) return iconPath;
  const appPath = await findAppPath(bundleId);
  if (!appPath) return null;
  const thumbnail = await app.thumbnail(appPath, ICON_SIZE);
  await tjs.copyFile(thumbnail.path, iconPath);
  return iconPath;
}
function getAppIconUrl(bundleId, app) {
  if (typeof bundleId !== "string") return Promise.resolve(null);
  let iconUrl = iconUrls.get(bundleId);
  if (!iconUrl) {
    iconUrl = loadAppIconUrl(bundleId, app);
    iconUrls.set(bundleId, iconUrl);
  }
  return iconUrl;
}
async function loadAppIconUrl(bundleId, app) {
  try {
    const iconPath = await saveAppIcon(bundleId, app);
    return iconPath ? await pngDataUrl(iconPath) : null;
  } catch (error) {
    logError(`appIcon failed for ${bundleId}:`, error);
    return null;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/utils/uuid-generatoe.ts
function generateUUID() {
  return crypto.randomUUID();
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/clipboard-history.ts
async function readClipboardItem(app) {
  const item = await app.clipboard.read();
  if (item.concealed || item.kind === "empty") return null;
  const bundleId = item.sourceApp?.bundleId;
  if (bundleId) {
    await saveAppIcon(bundleId, app).catch(
      (error) => logError(`saving icon for ${bundleId} failed:`, error)
    );
  }
  return saveClipboardImage(item, app);
}
async function saveClipboardImage(item, app) {
  if (item.kind !== "image" || !item.image) return item;
  const savedPath = `${await dataFolder(app, "images")}/${generateUUID()}-${item.changeCount}.png`;
  await tjs.copyFile(item.image, savedPath);
  return { ...item, image: savedPath };
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/database.ts
import { Database } from "tjs:sqlite";
var databasePromise = null;
function initializeDatabase(app) {
  databasePromise ??= openDatabase(app);
  return databasePromise;
}
async function openDatabase(app) {
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
    `
  );
  addSourceAppColumns(database);
  run(
    database,
    `
      CREATE INDEX IF NOT EXISTS clipboard_items_date_copied_index
      ON "CLIPBOARD_ITEMS" (dateCopied DESC)
    `
  );
  return database;
}
async function saveClipboardItem(item, app) {
  if (item.kind === "empty") {
    throw new Error("Cannot save an empty clipboard item");
  }
  const dateCopied = Date.now();
  const savedItem = {
    ...item,
    id: generateUUID(),
    dateCopied
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
    savedItem.sourceApp?.bundleId ?? null
  );
  return savedItem;
}
async function listClipboardItems(app) {
  const rows = all(
    await initializeDatabase(app),
    `
      SELECT id, kind, imageSize, path, value, dateCopied, sourceAppName, sourceAppBundleId
      FROM "CLIPBOARD_ITEMS"
      ORDER BY dateCopied DESC
    `
  );
  return rows.flatMap((row) => {
    const item = rowToClipboardItem(row, app);
    return item ? [item] : [];
  });
}
function serializeImageSize(item) {
  return item.kind === "image" && item.imageSize ? JSON.stringify(item.imageSize) : null;
}
function serializePath(item, app) {
  if (item.kind === "image") {
    if (!item.image) return null;
    const dataDirectory = `${app.paths.data}/`;
    if (!item.image.startsWith(dataDirectory)) {
      throw new Error(
        "Clipboard image was not saved to the app data directory"
      );
    }
    return item.image.slice(dataDirectory.length);
  }
  return item.kind === "files" ? JSON.stringify(item.paths) : null;
}
function serializeValue(item) {
  if (item.kind === "text") return item.text;
  if (item.kind === "color") return item.color;
  return null;
}
function addSourceAppColumns(database) {
  const columnNames = new Set(
    all(
      database,
      `PRAGMA table_info("CLIPBOARD_ITEMS")`
    ).map((column) => column.name)
  );
  if (!columnNames.has("sourceAppName")) {
    run(
      database,
      `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN sourceAppName TEXT`
    );
  }
  if (!columnNames.has("sourceAppBundleId")) {
    run(
      database,
      `ALTER TABLE "CLIPBOARD_ITEMS" ADD COLUMN sourceAppBundleId TEXT`
    );
  }
}
function rowToClipboardItem(row, app) {
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
    sourceURL: null
  };
}
function sourceAppFromRow(row) {
  if (row.sourceAppName == null && row.sourceAppBundleId == null) return null;
  return {
    name: row.sourceAppName,
    bundleId: row.sourceAppBundleId
  };
}
function isClipboardItemKind(value) {
  return value === "text" || value === "image" || value === "files" || value === "color";
}
function isValidDate(value) {
  return Number.isFinite(value) && value > 0;
}
function restoreImagePath(path, app) {
  if (!path || path.startsWith("/") || path.includes("..")) return null;
  return `${app.paths.data}/${path}`;
}
function parsePaths(path) {
  if (!path) return [];
  try {
    const paths = JSON.parse(path);
    return Array.isArray(paths) && paths.every((item) => typeof item === "string") ? paths : [];
  } catch {
    return [];
  }
}
function parseImageSize(imageSize) {
  if (!imageSize) return null;
  try {
    const parsed = JSON.parse(imageSize);
    if (!parsed || typeof parsed !== "object") return null;
    const { width, height } = parsed;
    return typeof width === "number" && typeof height === "number" ? { width, height } : null;
  } catch {
    return null;
  }
}
function run(database, query, ...values) {
  const statement = database.prepare(query);
  try {
    statement.run(...values);
  } finally {
    statement.finalize();
  }
}
function all(database, query) {
  const statement = database.prepare(query);
  try {
    return statement.all();
  } finally {
    statement.finalize();
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/file-previews.ts
var PREVIEW_SIZE = 64;
async function getFilePreview(path, app) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  const stats = await tjs.stat(path).catch(() => null);
  if (!stats) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return {
      url: await pngDataUrl(thumbnail.path),
      size: stats.isDirectory ? null : stats.size
    };
  } catch (error) {
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/main.ts
var api = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  filePreview: ({ path }, app) => getFilePreview(path, app)
};
async function onClipboardChange({ self }, app) {
  if (self) return;
  const item = await readClipboardItem(app);
  if (item) app.push("clipboard-item", await saveClipboardItem(item, app));
}
async function init(app) {
  await initializeDatabase(app);
  app.tray.set({ icon: "sf:sparkles.square.filled.on.square" });
  app.setHideOnClose(true);
}
export {
  api,
  init,
  onClipboardChange
};
