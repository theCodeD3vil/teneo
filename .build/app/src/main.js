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
  const savedPath = `${await dataFolder(app, "images")}/${Date.now()}-${item.changeCount}.png`;
  await tjs.copyFile(item.image, savedPath);
  return { ...item, image: savedPath };
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/file-previews.ts
var PREVIEW_SIZE = 64;
async function getFilePreviewUrl(path, app) {
  if (typeof path !== "string" || !path.startsWith("/")) return null;
  if (!await fileExists(path)) return null;
  try {
    const thumbnail = await app.thumbnail(path, PREVIEW_SIZE);
    return await pngDataUrl(thumbnail.path);
  } catch (error) {
    logError(`filePreview failed for ${path}:`, error);
    return null;
  }
}

// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/main.ts
var api = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  filePreview: ({ path }, app) => getFilePreviewUrl(path, app)
};
async function onClipboardChange({ self }, app) {
  if (self) return;
  const item = await readClipboardItem(app);
  if (item) app.push("clipboard-item", item);
}
function init(app) {
  app.tray.set({ icon: "sf:sparkles.square.filled.on.square" });
  app.setHideOnClose(true);
}
export {
  api,
  init,
  onClipboardChange
};
