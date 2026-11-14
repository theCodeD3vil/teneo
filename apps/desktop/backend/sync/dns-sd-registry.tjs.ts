// Tests of the pid file that lets a Teneo end the `dns-sd` children its
// predecessor left when it was killed. They run on the real runtime because they
// start real processes, and they end only those. Run with
// `bun run test:runtime` from apps/desktop.
/* oxlint-disable no-console -- a test run reports on the console */
import { pidFileName } from "./dns-sd-orphans";
import { ChildRegistry } from "./dns-sd-registry";
import { check, finish, same, test } from "./runtime-test";

const folder = await tjs.makeTempDir(`${tjs.tmpDir}/teneo-registry-XXXXXX`);
const started: ReturnType<typeof tjs.spawn>[] = [];

/** A real dns-sd, watching for a service type nobody announces. */
function startDnsSd() {
  const child = tjs.spawn(
    ["dns-sd", "-B", "_teneo-registry-test._tcp", "local"],
    { stdout: "ignore", stderr: "ignore", stdin: "ignore" },
  );
  started.push(child);
  return child;
}

/** A process that is not a dns-sd. */
function startSleep() {
  const child = tjs.spawn(["sleep", "60"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  started.push(child);
  return child;
}

/** A pid that no process has: one that has just ended. */
async function deadPid(): Promise<number> {
  const child = tjs.spawn(["true"], {
    stdout: "ignore",
    stderr: "ignore",
    stdin: "ignore",
  });
  await child.wait();
  return child.pid;
}

async function ends(
  child: ReturnType<typeof tjs.spawn>,
  within: number,
): Promise<boolean> {
  const timeout = new Promise<"running">((resolve) =>
    setTimeout(() => resolve("running"), within),
  );
  return (await Promise.race([child.wait(), timeout])) !== "running";
}

async function fileText(name: string): Promise<string | null> {
  try {
    return new TextDecoder().decode(await tjs.readFile(`${folder}/${name}`));
  } catch {
    return null;
  }
}

async function names(): Promise<string[]> {
  const found: string[] = [];
  for await (const entry of await tjs.readDir(folder)) found.push(entry.name);
  return found.sort();
}

async function clearFolder(): Promise<void> {
  for (const name of await names()) await tjs.remove(`${folder}/${name}`);
}

try {
  await test("it notes its children and forgets them as they end", async () => {
    await clearFolder();
    const registry = new ChildRegistry({ folder, ownerPid: 4001 });
    registry.add(111);
    registry.add(222);
    await registry.saved();
    same(await fileText(pidFileName(4001)), "111\n222\n", "both noted");
    registry.remove(111);
    await registry.saved();
    same(await fileText(pidFileName(4001)), "222\n", "one forgotten");
    registry.remove(222);
    registry.remove(222); // twice is harmless
    await registry.saved();
    same(await names(), [], "no file once none is left");
  });

  await test("it ends the dns-sd of a Teneo that is gone, and nothing else", async () => {
    await clearFolder();
    const orphan = startDnsSd();
    const bystander = startSleep();
    const gone = await deadPid();
    await tjs.writeFile(
      `${folder}/${pidFileName(gone)}`,
      `${orphan.pid}\n${bystander.pid}\n${await deadPid()}\n`,
    );
    const registry = new ChildRegistry({ folder, ownerPid: 4002 });
    same(await registry.reapLeftovers(), 1, "how many it ended");
    check(await ends(orphan, 3000), "the leftover dns-sd was not ended");
    same(await names(), [], "the file of the gone Teneo is forgotten");
    check(
      !(await ends(bystander, 300)),
      "a pid that is not a dns-sd was ended",
    );
  });

  await test("it leaves the children of a Teneo that still runs", async () => {
    await clearFolder();
    const live = startDnsSd();
    // the parent of this run is certainly running
    await tjs.writeFile(`${folder}/${pidFileName(tjs.ppid)}`, `${live.pid}\n`);
    const registry = new ChildRegistry({ folder, ownerPid: 4003 });
    same(await registry.reapLeftovers(), 0, "how many it ended");
    check(!(await ends(live, 500)), "a running Teneo's dns-sd was ended");
    same(await names(), [pidFileName(tjs.ppid)], "its file stays");
  });

  await test("it leaves its own children, and files that are not its kind", async () => {
    await clearFolder();
    const mine = startDnsSd();
    const registry = new ChildRegistry({ folder, ownerPid: 4004 });
    registry.add(mine.pid);
    await registry.saved();
    await tjs.writeFile(`${folder}/notes.txt`, `${mine.pid}\n`);
    await tjs.writeFile(`${folder}/bonjour-abc.pids`, `${mine.pid}\n`);
    same(await registry.reapLeftovers(), 0, "how many it ended");
    check(!(await ends(mine, 500)), "its own dns-sd was ended");
    same(
      await names(),
      ["bonjour-4004.pids", "bonjour-abc.pids", "notes.txt"],
      "no file touched",
    );
  });

  await test("a file with nothing usable in it is just forgotten", async () => {
    await clearFolder();
    const gone = await deadPid();
    await tjs.writeFile(`${folder}/${pidFileName(gone)}`, "not\n pids\n-1\n");
    const registry = new ChildRegistry({ folder, ownerPid: 4005 });
    same(await registry.reapLeftovers(), 0, "how many it ended");
    same(await names(), [], "forgotten");
  });

  await test("a folder that does not exist is nothing to reap", async () => {
    const registry = new ChildRegistry({
      folder: `${folder}/missing`,
      ownerPid: 4006,
    });
    same(await registry.reapLeftovers(), 0, "how many it ended");
  });
} finally {
  for (const child of started) {
    try {
      child.kill("SIGKILL");
    } catch {
      // already gone
    }
  }
  await Promise.all(started.map((child) => child.wait().catch(() => null)));
  await tjs.remove(folder).catch(() => {});
}
finish();
