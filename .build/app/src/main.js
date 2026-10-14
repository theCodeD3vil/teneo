// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/main.ts
var iconCache = /* @__PURE__ */ new Map();
var BUNDLE_ID_PATTERN = /^[\w.-]+$/;
var APP_FOLDERS = [
  "/Applications",
  "/System/Applications",
  "/System/Library/CoreServices",
  `${tjs.env.HOME}/Applications`
];
var textDecoder = new TextDecoder();
var installedApps;
async function runCommand(command) {
  const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
  const reader = child.stdout.getReader();
  let output = "";
  for (; ; ) {
    const { value, done } = await reader.read();
    if (done) break;
    output += textDecoder.decode(value, { stream: true });
  }
  const exit = await child.wait();
  return exit.exit_status === 0 ? output.trim() : "";
}
async function findAppWithSpotlight(bundleId) {
  const results = await runCommand([
    "/usr/bin/mdfind",
    `kMDItemCFBundleIdentifier == '${bundleId}'`
  ]);
  return results.split("\n").find((path) => path.endsWith(".app"));
}
async function readBundleId(appPath) {
  return runCommand([
    "/usr/bin/plutil",
    "-extract",
    "CFBundleIdentifier",
    "raw",
    `${appPath}/Contents/Info.plist`
  ]);
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
function getInstalledApps() {
  installedApps ??= (async () => {
    const apps = /* @__PURE__ */ new Map();
    for (const folder of APP_FOLDERS) await scanFolderForApps(folder, apps, 1);
    return apps;
  })();
  return installedApps;
}
async function findAppPath(bundleId) {
  if (typeof bundleId !== "string" || !BUNDLE_ID_PATTERN.test(bundleId)) {
    throw new Error(`invalid bundle id: ${bundleId}`);
  }
  const appPath = await findAppWithSpotlight(bundleId) ?? (await getInstalledApps()).get(bundleId);
  if (!appPath) throw new Error(`no app for ${bundleId}`);
  return appPath;
}
async function thumbnailUrl(path, size, app) {
  const thumbnail = await app.thumbnail(path, size);
  const png = await tjs.readFile(thumbnail.path);
  return `data:image/png;base64,${png.toBase64()}`;
}
async function fileExists(path) {
  try {
    await tjs.stat(path);
    return true;
  } catch {
    return false;
  }
}
var api = {
  async appIcon({ bundleId }, app) {
    if (iconCache.has(bundleId)) return iconCache.get(bundleId);
    let iconUrl = null;
    try {
      const appPath = await findAppPath(bundleId);
      iconUrl = await thumbnailUrl(appPath, 32, app);
    } catch (error) {
      console.error(`appIcon failed for ${bundleId}:`, error);
    }
    iconCache.set(bundleId, iconUrl);
    return iconUrl;
  },
  // Not cached: files change and get deleted, and a Quick Look thumbnail takes milliseconds.
  // Resolves null when the file is gone (moved or deleted since it was copied).
  async filePreview({ path }, app) {
    if (typeof path !== "string" || !path.startsWith("/")) return null;
    if (!await fileExists(path)) return null;
    try {
      return await thumbnailUrl(path, 64, app);
    } catch (error) {
      console.error(`filePreview failed for ${path}:`, error);
      return null;
    }
  }
};
function init(app) {
  app.tray.set({ icon: "sf:document.on.clipboard" });
  app.setHideOnClose(true);
}
export {
  api,
  init
};
