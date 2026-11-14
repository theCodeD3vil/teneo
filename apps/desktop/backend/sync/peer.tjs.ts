// `bun run sync:peer <recovery code>`: a second Teneo device with no window, on
// the real runtime, to sync with the app or with another peer. It has its own
// folder and a store that is only a file, so it never touches Teneo's data or
// Keychain. It prints what it does and what it receives (this is a test tool,
// so item text is shown), and reads commands on stdin:
//   copy <text>   pin <id>   unpin <id>   delete <id>   clear
//   list          peers      quit
// Options: --name <device name>  --dir <folder, kept between runs>
/* oxlint-disable no-console -- the peer talks on the console */
import { parseRecoveryCode } from "@teneo/sync";

import {
  listClipboardItems,
  saveClipboardItem,
  setClipboardItemPinned,
  softDeleteClipboardItem,
} from "../database";
import { clearClipboardHistory } from "../history-limits";
import { loadSettings, updateSettings } from "../settings";
import { clipboardHistoryChangedEvent } from "../types/clipboard";
import { LineSplitter } from "./lines";
import { startSyncService } from "./service";

const usage =
  "usage: bun run sync:peer <recovery code> [--name <device name>] [--dir <folder>]";

// --- arguments: tjs.args is [tjs, "run", script, ...ours]

const [code, ...flags] = tjs.args.slice(3);
const option = (name: string): string | undefined => {
  const at = flags.indexOf(name);
  return at >= 0 ? flags[at + 1] : undefined;
};
if (!code || code.startsWith("--")) {
  console.log(usage);
  tjs.exit(2);
}
const vaultKey = await parseRecoveryCode(code);
if (!vaultKey) {
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
const secrets = new Map<string, string>();

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
      return true;
    },
    delete: async (key: string) => secrets.delete(key),
  },
  push: (event: string) => {
    if (event === clipboardHistoryChangedEvent) console.log("changed");
  },
} as unknown as TinyApp;

await loadSettings(app);
await updateSettings({ syncEnabled: true }, app); // deletes leave tombstones

// --- start

const service = await startSyncService(app, {
  vaultKey,
  name: option("--name") ?? "Dev peer",
  platform: "dev",
  onPeersChanged: () => console.log(`peers ${peerNames().length}`),
  onError: (error) =>
    console.log(`error ${error instanceof Error ? error.message : error}`),
});
const peerNames = () => service.peers().map((peer) => peer.name);
console.log(`ready ${service.deviceId} ${service.port ?? "none"}`);

let quitting: Promise<never> | null = null;
function quit(): Promise<never> {
  // a signal and a command can both ask: stop once
  quitting ??= (async () => {
    await service.stop();
    if (!keepFolder) await tjs.remove(folder).catch(() => {});
    return tjs.exit(0);
  })();
  return quitting;
}
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  tjs.addSignalListener(signal, () => void quit());
}

// --- commands

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
  sourceApp: { name: "sync:peer", bundleId: null },
  sourceURL: null,
});

async function handle(line: string): Promise<void> {
  const [command = "", ...rest] = line.split(" ");
  const argument = rest.join(" ");
  switch (command) {
    case "copy": {
      const item = await saveClipboardItem(textItem(argument), app);
      service.localChanged();
      console.log(`ok copy ${item.id}`);
      break;
    }
    case "pin":
    case "unpin":
      await setClipboardItemPinned(argument, command === "pin", app);
      service.localChanged();
      console.log(`ok ${command}`);
      break;
    case "delete":
      await softDeleteClipboardItem(argument, app);
      service.localChanged();
      console.log("ok delete");
      break;
    case "clear":
      await clearClipboardHistory(app);
      service.localChanged();
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
          `item ${item.id} ${item.pinned ? "pinned" : "-"} ${JSON.stringify(item.text)}`,
        );
      }
      console.log("end list");
      break;
    }
    case "peers":
      console.log(`peers ${peerNames().length} ${peerNames().join(", ")}`);
      break;
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
