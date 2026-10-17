import { createApp } from './bridge.js';
import * as appMod from './src/main.js';

const FRONTEND = "http://127.0.0.1:5173";
const RESOURCES = "/Users/michaelnji/Projects/desktop-apps/teneo/resources";

const app = await createApp({
  htmlPath: FRONTEND,
  title: "Teneo",
  size: "560x640",
  version: "0.1.0",
  tinyjsVersion: "v0.53.1",
  id: "com.michael.teneo",
  resourcesPath: RESOURCES,
  api: appMod.api ?? {},
  onMenu: appMod.onMenu,
  onTray: appMod.onTray,
  onHotkey: appMod.onHotkey,
  onContextMenu: appMod.onContextMenu,
  onSystem: appMod.onSystem,
  onOpenUrl: appMod.onOpenUrl,
  onOpenFiles: appMod.onOpenFiles,
  onNotificationClick: appMod.onNotificationClick,
  onNotificationAction: appMod.onNotificationAction,
  onMediaKey: appMod.onMediaKey,
  onWindowClosed: appMod.onWindowClosed,
  onWindowState: appMod.onWindowState,
  onClipboardChange: appMod.onClipboardChange,
  onUpdateAvailable: appMod.onUpdateAvailable,
  onAudioTap: appMod.onAudioTap,
  onLocale: appMod.onLocale,
  onNavigate: appMod.onNavigate,
  onDownload: appMod.onDownload,
  onWindowOpen: appMod.onWindowOpen,
  url: null,
  downloads: null,
  popups: null,
  apiAccess: null,
  inject: null,
  chrome: {"windowControls":false,"frame":false,"vibrancy":"popover","transparent":true},
  update: null,
  activation: "accessory",
  mainWindow: true,
  readAccess: null,
  userAgent: null,
  audioTap: null,
  windowPlacement: null,
  contextMenu: true,
  browserAccelerators: false,
  debug: false,
  about: null,
  urlScheme: null,
  fileExtensions: null,
  openFolders: false,
  permissions: {},
  offscreenRescue: null,
});
if (appMod.init) appMod.init(app);

await app.done;
tjs.exit(0);
