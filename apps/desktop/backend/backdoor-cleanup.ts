// Teneo 0.4.2, as published on 16 November 2026, wasn't built by us: someone
// with access to the GitHub account uploaded a copy that installed a backdoor
// at ~/.teneo-sync-helper. From 0.4.3 Teneo stops and removes it at launch,
// and says so once (the next launch finds nothing left).
import { logError } from "./files";

export interface CleanupSystem {
  home: string;
  exists(path: string): Promise<boolean>;
  list(folder: string): Promise<string[]>;
  remove(path: string): Promise<void>;
  run(args: string[]): Promise<void>;
}

/** `pkill -f` patterns: the backdoor, a script it downloaded, its fake "Full Disk Access" prompt. */
export const backdoorProcesses = [
  "/\\.teneo-sync-helper",
  "dynamic\\?txd=",
  "/tmp/\\.fdaask-",
];

/** Stop and delete the backdoor. Resolves true when it was on this Mac. */
export async function removeBackdoor(system: CleanupSystem): Promise<boolean> {
  const helper = `${system.home}/.teneo-sync-helper`;
  const marker = `${system.home}/.teneo-sync.json`;
  if (!(await system.exists(helper)) && !(await system.exists(marker)))
    return false;

  for (const pattern of backdoorProcesses) {
    await system.run(["pkill", "-f", pattern]).catch(() => {});
  }
  const prompts = (await system.list("/tmp").catch(() => []))
    .filter((name) => name.startsWith(".fdaask-") && name.endsWith(".as"))
    .map((name) => `/tmp/${name}`);
  for (const path of [helper, marker, "/tmp/.httpcode", ...prompts]) {
    await system.remove(path).catch(() => {});
  }
  return true;
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
    remove: (path) => tjs.remove(path),
    run: async (args) => {
      await tjs.spawn(args, { stdout: "ignore", stderr: "ignore" }).wait();
    },
  };
}

export async function removeBackdoorAtLaunch(app: TinyApp): Promise<void> {
  try {
    if (!(await removeBackdoor(tjsSystem()))) return;
    await app.notify(
      "Teneo removed harmful software",
      "A fake Teneo 0.4.2 had installed it. The 0.4.3 release notes say what to do next.",
    );
  } catch (error) {
    logError("removing the 0.4.2 backdoor failed:", error);
  }
}
