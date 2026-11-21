// `bun run sync:peer <recovery code>`: a second Teneo device with no window, on
// the real runtime, to sync with the app or with another peer. It has its own
// folder and stores that are only files, so it never touches Teneo's data or
// Keychain. It prints what it does and what it receives (this is a test tool,
// so item text is shown), and reads commands on stdin:
//   copy <text>   pin <id>   unpin <id>   delete <id>   clear
//   list          peers      quit
// Options: --name <device name>  --dir <folder, kept between runs>
//
// `bun run sync:peer --app` runs sync the way the app does, through the same
// SyncManager, feature switch and signal handling, and sync starts off: it takes
// these commands as well, and the vault is a throwaway one of its own.
//   turnon   join <recovery code>   code   secrets on|off   off   status
/* oxlint-disable no-console -- the peer talks on the console */
import {
  type SyncStatus,
  syncStatusChangedEvent,
} from "@teneo/shared/types/sync";
import { parseRecoveryCode } from "@teneo/sync";

import {
  getSyncIdentity,
  initializeDatabase,
  listClipboardItems,
  saveClipboardItem,
  setClipboardItemPinned,
  softDeleteClipboardItem,
} from "../database";
import { clearClipboardHistory } from "../history-limits";
import { appPaths } from "../paths";
import { loadSettings, updateSettings } from "../settings";
import { clipboardHistoryChangedEvent } from "../types/clipboard";
import { createSyncManager, stopSyncWhenTold } from "./app-sync";
import { LineSplitter } from "./lines";
import { type SyncService, startSyncService } from "./service";
import type { SyncManager } from "./sync-manager";

const usage =
  "usage: bun run sync:peer <recovery code> | --app [--name <device name>] [--dir <folder>]";

// --- arguments: tjs.args is [tjs, "run", script, ...ours]

const args = tjs.args.slice(3);
const appMode = args[0] === "--app";
const code = appMode ? undefined : args[0];
const flags = appMode ? args : args.slice(1);
const option = (name: string): string | undefined => {
  const at = flags.indexOf(name);
  return at >= 0 ? flags[at + 1] : undefined;
};
if (!appMode && (!code || code.startsWith("--"))) {
  console.log(usage);
  tjs.exit(2);
}
const vaultKey = code ? await parseRecoveryCode(code) : null;
if (!appMode && !vaultKey) {
  console.log("That is not a valid recovery code");
  tjs.exit(2);
}

// --- an app with nothing real in it

const folder =
  option("--dir") ?? (await tjs.makeTempDir(`${tjs.tmpDir}/teneo-peer-XXXXXX`));
const keepFolder = option("--dir") !== undefined;
await tjs.makeDir(`${folder}/data`, { recursive: true });
await tjs.makeDir(`${folder}/cache`, { recursive: true });

// the device id lives in this file, so a restarted peer is the same device
const storePath = `${folder}/store.json`;
let stored: Record<string, unknown> = {};
try {
  stored = JSON.parse(new TextDecoder().decode(await tjs.readFile(storePath)));
} catch {
  // the first run
}
const saveStore = () => tjs.writeFile(storePath, JSON.stringify(stored));

// the "Keychain": a file here, so a restarted app-mode peer still has its key
const secretsPath = `${folder}/secrets.json`;
const secrets = new Map<string, string>();
try {
  const saved = JSON.parse(
    new TextDecoder().decode(await tjs.readFile(secretsPath)),
  ) as Record<string, string>;
  for (const [name, value] of Object.entries(saved)) secrets.set(name, value);
} catch {
  // the first run
}
const saveSecrets = () =>
  tjs.writeFile(secretsPath, JSON.stringify(Object.fromEntries(secrets)));

const connectedCount = (status: SyncStatus) =>
  status.devices.filter((device) => device.connected).length;

const app = {
  paths: async () => ({ data: `${folder}/data`, cache: `${folder}/cache` }),
  store: {
    get: async (key: string) => stored[key] ?? null,
    set: async (key: string, value: unknown) => {
      stored[key] = value;
      await saveStore();
      return true;
    },
  },
  secrets: {
    get: async (key: string) => secrets.get(key) ?? null,
    set: async (key: string, value: string) => {
      secrets.set(key, value);
      await saveSecrets();
      return true;
    },
    delete: async (key: string) => {
      const had = secrets.delete(key);
      await saveSecrets();
      return had;
    },
  },
  push: (event: string, payload?: unknown) => {
    if (event === clipboardHistoryChangedEvent) console.log("changed");
    if (event === syncStatusChangedEvent) {
      console.log(`peers ${connectedCount(payload as SyncStatus)}`);
    }
  },
  // no window process here: this peer ends by a signal, never by a quit
  done: new Promise<never>(() => {}),
} as unknown as TinyApp;

await loadSettings(app);

// --- start

let service: SyncService | null = null;
let manager: SyncManager | null = null;
if (appMode) {
  tjs.env.TENEO_SYNC = "1"; // on whatever the shell says: =0 would switch it off
  manager = createSyncManager(app);
  await initializeDatabase(app); // the app does this before it starts sync
  await manager.startIfEnabled();
  stopSyncWhenTold(manager, app);
  console.log(`ready ${getSyncIdentity().deviceId} app`);
} else {
  await updateSettings({ syncEnabled: true }, app); // deletes leave tombstones
  service = await startSyncService(app, {
    vaultKey: vaultKey!,
    name: option("--name") ?? "Dev peer",
    platform: "dev",
    onPeersChanged: () => console.log(`peers ${service?.peers().length ?? 0}`),
    onError: (error) =>
      console.log(`error ${error instanceof Error ? error.message : error}`),
  });
  console.log(`ready ${service.deviceId} ${service.port ?? "none"}`);
}

const connectedNames = async (): Promise<string[]> =>
  manager
    ? (await manager.status()).devices
        .filter((device) => device.connected)
        .map((device) => device.name)
    : service!.peers().map((peer) => peer.name);

const needManager = (): SyncManager => {
  if (!manager) throw new Error("that command needs --app");
  return manager;
};

let quitting: Promise<never> | null = null;
function quit(): Promise<never> {
  // a signal and a command can both ask: stop once
  quitting ??= (async () => {
    await (manager ?? service)!.stop();
    if (!keepFolder) await tjs.remove(folder).catch(() => {});
    return tjs.exit(0);
  })();
  return quitting;
}
// in app mode the app's own handler takes the signals
if (!appMode) {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    tjs.addSignalListener(signal, () => void quit());
  }
}

// --- commands

// the app the next copies are from: `from <bundle id> <name>` changes it, to
// try what goes by an item's app, such as the icon a phone asks for
let sourceApp: { name: string; bundleId: string | null } = {
  name: "sync:peer",
  bundleId: null,
};

const textItem = (text: string): Parameters<typeof saveClipboardItem>[0] => ({
  kind: "text",
  changeCount: 0,
  text,
  html: null,
  paths: [],
  image: null,
  imageSize: null,
  color: null,
  concealed: false,
  sourceApp,
  sourceURL: null,
});

async function handle(line: string): Promise<void> {
  const [command = "", ...rest] = line.split(" ");
  const argument = rest.join(" ");
  switch (command) {
    case "copy": {
      const item = await saveClipboardItem(textItem(argument), app);
      console.log(`ok copy ${item.id}`);
      break;
    }
    case "from": {
      const [bundleId = "", ...name] = rest;
      sourceApp = { name: name.join(" ") || bundleId, bundleId };
      console.log(`ok from ${sourceApp.name}`);
      break;
    }
    case "color": {
      // as the app saves a copied text that is a colour
      const item = await saveClipboardItem(
        { ...textItem(""), kind: "color", text: null, color: argument },
        app,
      );
      console.log(`ok color ${item.id}`);
      break;
    }
    case "image": {
      // a png file, copied in as the clipboard would hand one over, into
      // the app's data folder (data/dev in a dev run)
      const bytes = await tjs.readFile(argument);
      const size = new DataView(bytes.buffer, bytes.byteOffset + 16, 8);
      const { data } = await appPaths(app);
      const saved = `${data}/images/${crypto.randomUUID()}.png`;
      await tjs.makeDir(`${data}/images`, { recursive: true });
      await tjs.writeFile(saved, bytes);
      const item = await saveClipboardItem(
        {
          ...textItem(""),
          kind: "image",
          text: null,
          image: saved,
          imageSize: { width: size.getUint32(0), height: size.getUint32(4) },
        },
        app,
      );
      console.log(`ok image ${item.id}`);
      break;
    }
    case "pin":
    case "unpin":
      await setClipboardItemPinned(argument, command === "pin", app);
      console.log(`ok ${command}`);
      break;
    case "delete":
      await softDeleteClipboardItem(argument, app);
      console.log("ok delete");
      break;
    case "clear":
      await clearClipboardHistory(app);
      console.log("ok clear");
      break;
    case "list": {
      const page = await listClipboardItems(app, {
        kind: "all",
        search: "",
        limit: 1000,
      });
      for (const item of page.items) {
        console.log(
          `item ${item.id} ${item.pinned ? "pinned" : "-"} ${
            item.kind === "image"
              ? `image ${item.imageSize?.width}x${item.imageSize?.height} ${item.image}`
              : item.kind === "color"
                ? `color ${item.color}`
                : JSON.stringify(item.text)
          }${item.originMaker ? ` maker=${item.originMaker}` : ""}`,
        );
      }
      console.log("end list");
      break;
    }
    case "peers": {
      const names = await connectedNames();
      console.log(`peers ${names.length} ${names.join(", ")}`);
      break;
    }
    // app mode: what the Sync tab does
    case "turnon":
      await needManager().turnOn();
      console.log("ok turnon");
      break;
    case "join":
      await needManager().join(argument);
      console.log("ok join");
      break;
    case "off":
      await needManager().turnOff();
      console.log("ok off");
      break;
    case "secrets":
      await needManager().setSyncSecrets(argument === "on");
      console.log(`ok secrets ${argument}`);
      break;
    case "code":
      // the throwaway vault of this peer: showing its code is the point
      {
        // the join code, and the QR code's link (a one-time key)
        const info = await needManager().pairingInfo();
        console.log(`code ${info.recoveryCode}`);
        console.log(`link ${info.link}`);
      }
      break;
    case "status": {
      const status = await needManager().status();
      console.log(
        `status enabled=${status.enabled} running=${status.running} problem=${status.problem ?? "none"} devices=${status.devices.length} connected=${connectedCount(status)}`,
      );
      break;
    }
    case "quit":
      await quit();
      break;
    case "":
      break;
    default:
      console.log(`unknown command: ${command}`);
  }
}

const reader = tjs.stdin.getReader();
const decoder = new TextDecoder();
const lines = new LineSplitter();
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  for (const line of lines.push(decoder.decode(value, { stream: true }))) {
    try {
      await handle(line.trim());
    } catch (error) {
      console.log(
        `error ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
await quit(); // stdin closed
