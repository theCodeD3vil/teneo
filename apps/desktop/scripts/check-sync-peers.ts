// `bun run sync:check`: two headless peers on this Mac, on the real runtime,
// find each other through Bonjour and have to end up with the same history:
// copies, pins, deletes, a clear, and a peer that was off while things changed.
// A last part runs one peer the way the app does (through SyncManager: turned on
// and off, joined by recovery code, the secrets switch, quit by SIGTERM) against
// a plain peer. It uses no Teneo data (each peer has a temp folder) and leaves
// nothing running. Exit code 0 only when everything held.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

import { syncPorts } from "../backend/sync/ports.ts";
import { bundleForTjs, tjsBinary } from "./tjs-tools.ts";

const connectTimeout = 60_000; // Bonjour can take a while to notice a new peer
const syncTimeout = 20_000;
const wholeRunTimeout = 480_000;

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

  // `code` null runs the peer the way the app does (--app)
  private constructor(
    name: string,
    bundle: string,
    code: string | null,
    dir: string,
  ) {
    this.name = name;
    this.child = spawn(
      tjsBinary,
      ["run", bundle, code ?? "--app", "--name", name, "--dir", dir],
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
    code: string | null,
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

  /** How sync is going, as an app-mode peer says. */
  async status() {
    return this.ask("status", (line) => {
      const found =
        /^status enabled=(\w+) running=(\w+) problem=(.*) devices=(\d+) connected=(\d+)$/.exec(
          line,
        );
      return found
        ? {
            enabled: found[1] === "true",
            running: found[2] === "true",
            problem: found[3]!,
            devices: Number(found[4]),
            connected: Number(found[5]),
          }
        : undefined;
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

  get pid(): number {
    return this.child.pid!;
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

/** The Bonjour children that started during this run and still run. */
const newBonjourChildren = (): string[] =>
  [...bonjourChildren()].filter((pid) => !bonjourBefore.has(pid));

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

  // a peer that is killed outright can't end its Bonjour children, and they
  // announce a port nobody listens on: the next peer of that folder ends them
  const pidFileOf = (peer: Peer) =>
    join(dirA, "cache", `bonjour-${peer.pid}.pids`);
  const c = await Peer.start("Peer C", bundle, code, dirA);
  peers.push(c);
  await eventually(
    "C's Bonjour processes to be noted down",
    async () => newBonjourChildren().length >= 2 && existsSync(pidFileOf(c)),
  );
  c.kill();
  await c.exited;
  await pause(500);
  const orphans = newBonjourChildren();
  if (orphans.length < 2) {
    throw new Error(
      "a killed peer left no Bonjour process, so this check proves nothing",
    );
  }
  // D is C after a crash. A leftover can end on its own (it dies when it next
  // writes to the pipe of a parent that is gone), so the proof that D cleaned
  // up is C's pid file: only a Teneo that reaps removes another's.
  const d = await Peer.start("Peer D", bundle, code, dirA);
  peers.push(d);
  await eventually("D to end what C left running", async () => {
    const running = bonjourChildren();
    return (
      !existsSync(pidFileOf(c)) && orphans.every((pid) => !running.has(pid))
    );
  });
  await d.stop();
  await pause(500);
  if (newBonjourChildren().length > 0) {
    throw new Error("Bonjour processes left running after D stopped");
  }
  pass(
    "a peer killed outright left Bonjour processes and a pid file; the next one cleaned up",
  );

  // --- the app's way of running sync: the SyncManager the Sync tab uses
  const secretOne = "postgres://user:s3cretA@db.example.com/app";
  const secretTwo = "postgres://user:s3cretB@db.example.com/app";
  const secretThree = "postgres://user:s3cretC@db.example.com/app";
  const dirM = join(folder, "m");
  const dirP = join(folder, "p");

  let m = await Peer.start("App M", bundle, null, dirM);
  peers.push(m);
  let status = await m.status();
  if (status.enabled || status.running) {
    throw new Error("the app-mode peer had sync on before it was turned on");
  }
  // history that exists before sync is turned on, one item of it with a secret
  await m.copy("before-sync");
  await m.copy(secretOne);
  await m.command("turnon", "ok turnon");
  status = await m.status();
  if (!status.enabled || !status.running) {
    throw new Error(
      `turning sync on did not start it: ${JSON.stringify(status)}`,
    );
  }
  const mCode = await m.ask("code", (line) => /^code (\S+)/.exec(line)?.[1]);
  const p = await Peer.start("Peer P", bundle, mCode, dirP);
  peers.push(p);
  await eventually(
    "M and P to connect",
    async () => m.connected >= 1 && p.connected >= 1,
    connectTimeout,
  );
  await eventually(
    "P to get the history M had before sync was on",
    async () => !!find(await p.list(), "before-sync"),
  );
  if (find(await p.list(), secretOne)) {
    throw new Error("an item with a secret was sent while that is off");
  }
  pass(
    "the app turned sync on, a peer joined with its recovery code, and the existing history arrived, but not the secret",
  );

  // changes made on the app side reach the peer with nothing but the app's wiring
  const mOne = await m.copy("m-one");
  await eventually(
    "P to get m-one",
    async () => !!find(await p.list(), "m-one"),
  );
  const pOne = await p.copy("p-one");
  await eventually(
    "M to get p-one",
    async () => !!find(await m.list(), "p-one"),
  );
  await m.command(`pin ${mOne}`, "ok pin");
  await eventually(
    "P to see m-one pinned",
    async () => find(await p.list(), "m-one")?.pinned === true,
  );
  await p.command(`delete ${pOne}`, "ok delete");
  await eventually(
    "M to drop p-one",
    async () => !find(await m.list(), "p-one"),
  );
  pass("a copy, a pin and a delete went both ways through the app's wiring");

  // the secrets switch: held back, sent when turned on, held back when turned off
  await m.command("secrets on", "ok secrets on");
  await eventually(
    "P to get the secret that was held back",
    async () => !!find(await p.list(), secretOne),
  );
  await m.copy(secretTwo);
  await eventually(
    "P to get a secret copied while the switch is on",
    async () => !!find(await p.list(), secretTwo),
  );
  await m.command("secrets off", "ok secrets off");
  await m.copy(secretThree);
  await m.copy("after-secrets-off");
  await eventually(
    "P to get what was copied after the secret",
    async () => !!find(await p.list(), "after-secrets-off"),
  );
  if (find(await p.list(), secretThree)) {
    throw new Error("a secret was sent after the switch was turned off");
  }
  pass("secrets were held back, sent when the switch went on, held back again");

  await m.command("clear", "ok clear");
  await eventually("P to be cleared but for the pinned item", async () => {
    const items = await p.list();
    return items.length === 1 && items[0]?.text === "m-one" && items[0].pinned;
  });
  const [listM, listP] = [await m.list(), await p.list()];
  if (summary(listM) !== summary(listP)) {
    throw new Error(
      `the histories differ:\nM:\n${summary(listM)}\nP:\n${summary(listP)}`,
    );
  }
  pass("a clear on the app side left only the pinned item, on both");

  // quit with a plain SIGTERM, as the system does: Bonjour ends, and the next
  // launch turns sync on by itself, as the same device, and catches up
  const mDeviceId = m.deviceId;
  await pause(1000);
  const runningBefore = newBonjourChildren().length;
  await m.stop("SIGTERM");
  await pause(500);
  if (newBonjourChildren().length > runningBefore - 2) {
    throw new Error(
      "the app-mode peer left its Bonjour processes after SIGTERM",
    );
  }
  await eventually(
    "P to notice M is gone",
    async () => p.connected === 0,
    connectTimeout,
  );
  await p.copy("while-m-was-off");
  m = await Peer.start("App M", bundle, null, dirM);
  peers.push(m);
  if (m.deviceId !== mDeviceId)
    throw new Error("M came back as another device");
  status = await m.status();
  if (!status.enabled || !status.running) {
    throw new Error(
      `sync did not come back at launch: ${JSON.stringify(status)}`,
    );
  }
  await eventually(
    "M to catch up after its restart",
    async () => !!find(await m.list(), "while-m-was-off"),
    connectTimeout,
  );
  pass(
    "SIGTERM ended Bonjour; the next launch turned sync on by itself and caught up",
  );

  // turned off, nothing announces or listens, and it stays off after a restart
  await m.command("off", "ok off");
  status = await m.status();
  if (status.enabled || status.running) {
    throw new Error(
      `turning sync off did not stop it: ${JSON.stringify(status)}`,
    );
  }
  await eventually(
    "P to see M go",
    async () => p.connected === 0,
    connectTimeout,
  );
  await p.stop();
  await pause(500);
  const keptItems = (await m.list()).length;
  if (keptItems === 0) throw new Error("turning sync off removed the history");
  await m.stop();
  m = await Peer.start("App M", bundle, null, dirM);
  peers.push(m);
  await pause(1500);
  status = await m.status();
  if (status.enabled || status.running) {
    throw new Error("sync came back on after it was turned off");
  }
  if (newBonjourChildren().length > 0) {
    throw new Error("Bonjour processes are running with sync off");
  }
  for (const port of syncPorts) {
    if (!(await portIsFree(port))) {
      throw new Error(`port ${port} is taken with sync off`);
    }
  }
  if ((await m.list()).length !== keptItems) {
    throw new Error("the history changed across the restart");
  }
  await m.stop();
  pass(
    "turned off: nothing announces or listens, the history is kept, and it stays off after a restart",
  );

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
