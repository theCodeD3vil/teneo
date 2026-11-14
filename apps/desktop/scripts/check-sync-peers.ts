// `bun run sync:check`: two headless peers on this Mac, on the real runtime,
// find each other through Bonjour and have to end up with the same history:
// copies, pins, deletes, a clear, and a peer that was off while things changed.
// It uses no Teneo data (each peer has a temp folder) and leaves nothing running.
// Exit code 0 only when everything held.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { syncPorts } from "../backend/sync/ports.ts";
import { bundleForTjs, tjsBinary } from "./tjs-tools.ts";

const connectTimeout = 60_000; // Bonjour can take a while to notice a new peer
const syncTimeout = 20_000;
const wholeRunTimeout = 240_000;

interface Item {
  id: string;
  pinned: boolean;
  text: string;
}

type LineTest<T> = (line: string) => T | undefined;

/** One headless peer: a child process we talk to in lines. */
class Peer {
  readonly name: string;
  deviceId = "";
  port = 0;
  connected = 0;
  readonly lines: string[] = [];
  private listeners = new Set<(line: string) => void>();
  private child: ChildProcess;
  readonly exited: Promise<void>;

  private constructor(name: string, bundle: string, code: string, dir: string) {
    this.name = name;
    this.child = spawn(
      tjsBinary,
      ["run", bundle, code, "--name", name, "--dir", dir],
      { stdio: ["pipe", "pipe", "pipe"] },
    );
    const onLine = (line: string) => {
      this.lines.push(line);
      const peers = /^peers (\d+)/.exec(line);
      if (peers) this.connected = Number(peers[1]);
      for (const listener of this.listeners) listener(line);
    };
    createInterface({ input: this.child.stdout! }).on("line", onLine);
    createInterface({ input: this.child.stderr! }).on("line", (line) =>
      onLine(`stderr ${line}`),
    );
    this.exited = new Promise((resolve) =>
      this.child.on("exit", () => resolve()),
    );
  }

  static async start(
    name: string,
    bundle: string,
    code: string,
    dir: string,
  ): Promise<Peer> {
    const peer = new Peer(name, bundle, code, dir);
    const [deviceId, port] = await peer.waitFor(
      (line) => /^ready (\S+) (\S+)/.exec(line)?.slice(1),
      30_000,
      "to start",
    );
    peer.deviceId = deviceId!;
    peer.port = Number(port);
    return peer;
  }

  /** The first line from now on that `test` accepts. */
  waitFor<T>(test: LineTest<T>, timeout: number, what: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(listener);
        reject(new Error(`${this.name} did not ${what} in time`));
      }, timeout);
      const listener = (line: string) => {
        const found = test(line);
        if (found === undefined) return;
        clearTimeout(timer);
        this.listeners.delete(listener);
        resolve(found);
      };
      this.listeners.add(listener);
    });
  }

  /** Send a command and wait for the line that answers it. */
  async ask<T>(command: string, test: LineTest<T>): Promise<T> {
    const answer = this.waitFor(test, 15_000, `answer "${command}"`);
    this.child.stdin!.write(`${command}\n`);
    return answer;
  }

  async copy(text: string): Promise<string> {
    return this.ask(`copy ${text}`, (line) => /^ok copy (\S+)/.exec(line)?.[1]);
  }

  async command(command: string, done: string): Promise<void> {
    await this.ask(command, (line) => (line === done ? true : undefined));
  }

  async list(): Promise<Item[]> {
    const items: Item[] = [];
    return this.ask("list", (line) => {
      const item = /^item (\S+) (pinned|-) (.*)$/.exec(line);
      if (item) {
        items.push({
          id: item[1]!,
          pinned: item[2] === "pinned",
          text: JSON.parse(item[3]!) as string,
        });
      }
      return line === "end list" ? items : undefined;
    });
  }

  /** Ask politely, then insist, so nothing is left running. */
  async stop(signal: "quit" | "SIGTERM" = "quit"): Promise<void> {
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (signal === "quit") this.child.stdin!.write("quit\n");
    else this.child.kill("SIGTERM");
    const gone = await Promise.race([
      this.exited.then(() => true),
      new Promise<boolean>((resolve) =>
        setTimeout(() => resolve(false), 10_000),
      ),
    ]);
    if (!gone) {
      this.child.kill("SIGKILL");
      await this.exited;
      throw new Error(`${this.name} did not stop when asked`);
    }
  }

  kill(): void {
    this.child.kill("SIGKILL");
  }
}

// --- helpers

async function eventually(
  what: string,
  check: () => Promise<boolean>,
  timeout = syncTimeout,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

const find = (items: Item[], text: string) =>
  items.find((item) => item.text === text);

const summary = (items: Item[]) =>
  items
    .map((item) => `${item.id} ${item.pinned ? "p" : "-"} ${item.text}`)
    .sort()
    .join("\n");

/** A fresh vault's recovery code, made by the backend entry that may import
 *  the sync package (this script's config is Node-only). */
function newRecoveryCode(): string {
  const made = spawnSync(
    process.execPath,
    ["backend/sync/new-recovery-code.ts"],
    { encoding: "utf8" },
  );
  const code = made.stdout.trim();
  if (made.status !== 0 || !code) {
    throw new Error(`could not make a recovery code: ${made.stderr}`);
  }
  return code;
}

/** Connect the way a stranger would: open, say something that is not Teneo,
 *  and wait to be dropped. */
function failHandshake(port: number): Promise<void> {
  return new Promise((resolve) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}`);
    const timer = setTimeout(() => {
      socket.close();
      resolve();
    }, 5000);
    socket.onopen = () => socket.send("this is not Teneo");
    socket.onerror = () => {};
    socket.onclose = () => {
      clearTimeout(timer);
      resolve();
    };
  });
}

function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "0.0.0.0", () => server.close(() => resolve(true)));
  });
}

/** Process ids of the Bonjour children Teneo's sync starts. */
function bonjourChildren(): Set<string> {
  const found = spawnSync("pgrep", ["-f", "dns-sd.*_teneo-sync"], {
    encoding: "utf8",
  });
  return new Set(found.stdout.split("\n").filter(Boolean));
}

// --- the run

let step = 0;
const pass = (what: string) => console.log(`  ok ${++step}. ${what}`);

const folder = mkdtempSync(join(tmpdir(), "teneo-sync-check-"));
const peers: Peer[] = [];
const bonjourBefore = bonjourChildren();
let failed = false;

try {
  for (const port of syncPorts) {
    if (!(await portIsFree(port))) {
      throw new Error(
        `port ${port} is in use (Teneo, or another peer, is already syncing): stop it and run this again`,
      );
    }
  }

  console.log("bundling the peer…");
  const bundle = join(folder, "peer.js");
  bundleForTjs("backend/sync/peer.tjs.ts", bundle);
  const code = newRecoveryCode();
  const dirA = join(folder, "a");
  const dirB = join(folder, "b");

  const timeout = setTimeout(() => {
    console.error("the whole run took too long");
    for (const peer of peers) peer.kill();
    process.exit(1);
  }, wholeRunTimeout);
  timeout.unref();

  const a = await Peer.start("Peer A", bundle, code, dirA);
  peers.push(a);
  let b = await Peer.start("Peer B", bundle, code, dirB);
  peers.push(b);
  pass(
    `two peers started (${a.deviceId.slice(0, 8)}, ${b.deviceId.slice(0, 8)})`,
  );

  await eventually(
    "the peers to find each other",
    async () => a.connected >= 1 && b.connected >= 1,
    connectTimeout,
  );
  pass("they found each other and connected");

  // a copy travels, and so does a pin
  const alphaId = await a.copy("alpha");
  await eventually(
    "B to get alpha",
    async () => !!find(await b.list(), "alpha"),
  );
  await a.command(`pin ${alphaId}`, "ok pin");
  await eventually(
    "B to see alpha pinned",
    async () => find(await b.list(), "alpha")?.pinned === true,
  );
  pass("a copy and a pin on A reached B");

  // and the other way round
  await b.copy("bravo");
  await eventually(
    "A to get bravo",
    async () => !!find(await a.list(), "bravo"),
  );
  pass("a copy on B reached A");

  // a delete
  const charlieId = await a.copy("charlie");
  await eventually(
    "B to get charlie",
    async () => !!find(await b.list(), "charlie"),
  );
  await a.command(`delete ${charlieId}`, "ok delete");
  await eventually(
    "B to drop charlie",
    async () => !find(await b.list(), "charlie"),
  );
  pass("a delete on A reached B");

  // B is off while A copies: it catches up when it is back, with no repeats
  const bDeviceId = b.deviceId;
  await b.stop();
  await eventually(
    "A to notice B is gone",
    async () => a.connected === 0,
    connectTimeout,
  );
  await a.copy("delta");
  await a.copy("echo");
  b = await Peer.start("Peer B", bundle, code, dirB);
  peers.push(b);
  if (b.deviceId !== bDeviceId)
    throw new Error("B came back as a different device");
  await eventually(
    "B to catch up after its restart",
    async () => {
      const items = await b.list();
      return !!find(items, "delta") && !!find(items, "echo");
    },
    connectTimeout,
  );
  const afterRestart = await b.list();
  if (
    new Set(afterRestart.map((item) => item.id)).size !== afterRestart.length
  ) {
    throw new Error("B has the same item twice after catching up");
  }
  pass("B restarted, kept its identity, caught up with nothing doubled");

  // clearing history keeps what is pinned, on both
  await a.command("clear", "ok clear");
  await eventually("B to be cleared but for the pinned item", async () => {
    const items = await b.list();
    return items.length === 1 && items[0]?.text === "alpha" && items[0].pinned;
  });
  pass("a clear on A left only the pinned item, on both");

  const [listA, listB] = [await a.list(), await b.list()];
  if (summary(listA) !== summary(listB)) {
    throw new Error(
      `the histories differ:\nA:\n${summary(listA)}\nB:\n${summary(listB)}`,
    );
  }
  pass("both histories are identical");

  // a client that is not Teneo is turned away, then blocked, and the peers go on
  const url = `http://127.0.0.1:${a.port}/`;
  if ((await fetch(url)).status !== 426) {
    throw new Error("a plain web request was not answered with 426");
  }
  for (let attempt = 0; attempt < 5; attempt++) await failHandshake(a.port);
  if ((await fetch(url)).status !== 429) {
    throw new Error("an address that failed five handshakes was not blocked");
  }
  await a.copy("foxtrot");
  await eventually(
    "B to get foxtrot while the stranger was blocked",
    async () => !!find(await b.list(), "foxtrot"),
  );
  pass(
    "a client that did not speak Teneo was refused, then blocked; the peers carried on",
  );

  // shutting down leaves nothing behind
  await a.stop("SIGTERM"); // a plain kill, as the system sends one
  await b.stop();
  await new Promise((resolve) => setTimeout(resolve, 500));
  const left = [...bonjourChildren()].filter((pid) => !bonjourBefore.has(pid));
  if (left.length > 0)
    throw new Error(`Bonjour processes left running: ${left.join(", ")}`);
  pass("stopping the peers left no Bonjour process behind");

  console.log("\nthe peers stayed in sync");
} catch (error) {
  failed = true;
  console.error(
    `\nFAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
  for (const peer of peers) {
    console.error(`\n--- last output of ${peer.name} ---`);
    console.error(peer.lines.slice(-25).join("\n"));
  }
} finally {
  // only what this run started: the peers, and any new Bonjour child
  for (const peer of peers) peer.kill();
  await Promise.all(peers.map((peer) => peer.exited));
  if (failed) {
    for (const pid of bonjourChildren()) {
      if (!bonjourBefore.has(pid)) process.kill(Number(pid), "SIGTERM");
    }
  }
  rmSync(folder, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
