// Teneo 0.4.2, as published on 16 November 2026, wasn't built by us: someone
// with access to the GitHub account uploaded a copy that installed a backdoor
// at ~/.teneo-sync-helper. From 0.4.3 Teneo stops and removes it at launch.
//
// It also looks wherever the helper could have set itself to start again (a
// LaunchAgent, the crontab, a shell profile), checks afterwards that nothing
// is left, and keeps a note that this Mac had it: until the user has changed
// the passwords and keys they copied since, that matters more than the files.
import { logError } from "./files";

export interface CleanupSystem {
  home: string;
  exists(path: string): Promise<boolean>;
  list(folder: string): Promise<string[]>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  remove(path: string): Promise<void>;
  /** Runs a command; resolves with its output and whether it succeeded. */
  run(args: string[], input?: string): Promise<{ ok: boolean; output: string }>;
}

/** `pkill -f` patterns: the backdoor, a script it downloaded, its fake "Full Disk Access" prompt. */
export const backdoorProcesses = [
  "/\\.teneo-sync-helper",
  "dynamic\\?txd=",
  "/tmp/\\.fdaask-",
];

const helperName = ".teneo-sync-helper";

export type CleanupResult =
  /** never on this Mac */
  | "absent"
  /** found, and nothing of it is left */
  | "removed"
  /** found, and something of it is still there: tried again at next launch */
  | "incomplete";

const profiles = [
  ".zshrc",
  ".zprofile",
  ".zshenv",
  ".bash_profile",
  ".bashrc",
  ".profile",
];

/** Every place the backdoor is, or set itself to start from. */
async function findTraces(system: CleanupSystem): Promise<string[]> {
  const { home } = system;
  const traces: string[] = [];
  for (const path of [`${home}/${helperName}`, `${home}/.teneo-sync.json`]) {
    if (await system.exists(path)) traces.push(path);
  }
  for (const pattern of backdoorProcesses) {
    // pgrep succeeds only when a process matches
    if ((await system.run(["pgrep", "-f", pattern])).ok)
      traces.push(`process ${pattern}`);
  }
  const agents = `${home}/Library/LaunchAgents`;
  for (const name of await system.list(agents).catch(() => [])) {
    if (!name.endsWith(".plist")) continue;
    const text = await system.read(`${agents}/${name}`).catch(() => "");
    if (text.includes(helperName)) traces.push(`${agents}/${name}`);
  }
  const crontab = await system.run(["crontab", "-l"]);
  if (crontab.ok && crontab.output.includes(helperName)) traces.push("crontab");
  for (const profile of profiles) {
    const path = `${home}/${profile}`;
    const text = await system.read(path).catch(() => "");
    if (text.includes(helperName)) traces.push(path);
  }
  return traces;
}

const withoutHelperLines = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.includes(helperName))
    .join("\n");

/** Stop and delete the backdoor, and whatever starts it again. */
export async function removeBackdoor(
  system: CleanupSystem,
): Promise<CleanupResult> {
  const { home } = system;
  const traces = await findTraces(system);
  if (traces.length === 0) return "absent";

  for (const pattern of backdoorProcesses) {
    await system.run(["pkill", "-f", pattern]).catch(() => undefined);
  }
  const uid = (await system.run(["id", "-u"])).output.trim();
  for (const trace of traces) {
    if (trace.endsWith(".plist")) {
      // stopped by launchd first, or it starts the helper again
      await system
        .run(["launchctl", "bootout", `gui/${uid}`, trace])
        .catch(() => undefined);
      await system.remove(trace).catch(() => undefined);
    } else if (trace === "crontab") {
      const crontab = await system.run(["crontab", "-l"]);
      await system
        .run(
          ["crontab", "-"],
          `${withoutHelperLines(crontab.output).trimEnd()}\n`,
        )
        .catch(() => undefined);
    } else if (profiles.some((profile) => trace === `${home}/${profile}`)) {
      // only the lines that start the helper: the rest is the user's own
      const text = await system.read(trace).catch(() => null);
      if (text !== null)
        await system
          .write(trace, withoutHelperLines(text))
          .catch(() => undefined);
    }
  }
  const prompts = (await system.list("/tmp").catch(() => []))
    .filter((name) => name.startsWith(".fdaask-") && name.endsWith(".as"))
    .map((name) => `/tmp/${name}`);
  for (const path of [
    `${home}/${helperName}`,
    `${home}/.teneo-sync.json`,
    "/tmp/.httpcode",
    ...prompts,
  ]) {
    await system.remove(path).catch(() => undefined);
  }
  // done only when a second look finds nothing
  return (await findTraces(system)).length === 0 ? "removed" : "incomplete";
}

function tjsSystem(): CleanupSystem {
  return {
    home: tjs.homeDir,
    exists: (path) =>
      tjs.stat(path).then(
        () => true,
        () => false,
      ),
    list: async (folder) => {
      const names: string[] = [];
      for await (const entry of await tjs.readDir(folder))
        names.push(entry.name);
      return names;
    },
    read: async (path) => new TextDecoder().decode(await tjs.readFile(path)),
    write: (path, text) => tjs.writeFile(path, new TextEncoder().encode(text)),
    remove: (path) => tjs.remove(path),
    run: async (args, input) => {
      try {
        const child = tjs.spawn(args, {
          stdin: input === undefined ? "ignore" : "pipe",
          stdout: "pipe",
          stderr: "ignore",
        });
        if (input !== undefined) {
          const writer = child.stdin!.getWriter();
          await writer.write(new TextEncoder().encode(input));
          await writer.close();
        }
        const output = await new Response(child.stdout).text();
        const status = await child.wait();
        return { ok: status.exit_status === 0, output };
      } catch {
        return { ok: false, output: "" };
      }
    },
  };
}

/** Where app.store keeps when the backdoor was found: shown in Settings ›
 *  About, with what to do about it, for as long as Teneo is installed. */
export const backdoorFoundKey = "backdoorFoundAt";

export async function removeBackdoorAtLaunch(app: TinyApp): Promise<void> {
  try {
    const result = await removeBackdoor(tjsSystem());
    if (result === "absent") return;
    if ((await app.store.get(backdoorFoundKey)) == null)
      await app.store.set(backdoorFoundKey, Date.now());
    await app.notify(
      result === "removed"
        ? "Teneo removed harmful software"
        : "Teneo found harmful software it couldn't fully remove",
      result === "removed"
        ? "A fake Teneo 0.4.2 had installed it. Change the passwords and keys you copied since 16 November. Settings › About says more."
        : "A fake Teneo 0.4.2 had installed it. Teneo tries again at its next launch. Change the passwords and keys you copied since 16 November.",
    );
  } catch (error) {
    logError("removing the 0.4.2 backdoor failed:", error);
  }
}

/** When this Mac was found to have the backdoor, or null if it never was. */
export async function backdoorFoundAt(app: TinyApp): Promise<number | null> {
  const value = await app.store.get(backdoorFoundKey);
  return typeof value === "number" ? value : null;
}
