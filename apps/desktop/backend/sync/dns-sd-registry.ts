// Notes the pids of this Teneo's `dns-sd` children in a file of its own, and
// ends the ones an earlier Teneo left when it was killed. See dns-sd-orphans.ts
// for why, and for the parts that need no runtime. Everything here is best
// effort: a registry that can't write must never stop sync.
import {
  formatPids,
  isDnsSdCommand,
  ownerOfPidFile,
  parsePids,
  pidFileName,
} from "./dns-sd-orphans";

export interface ChildRegistryOptions {
  /** Where the pid files live: a folder of this app's own. */
  folder: string;
  /** This Teneo's pid; the runtime's own unless a test says otherwise. */
  ownerPid?: number;
}

export class ChildRegistry {
  private readonly folder: string;
  private readonly ownerPid: number;
  private readonly live = new Set<number>();
  // writes go one after another, each saving what is live by then
  private writing: Promise<void> = Promise.resolve();

  constructor(options: ChildRegistryOptions) {
    this.folder = options.folder;
    this.ownerPid = options.ownerPid ?? tjs.pid;
  }

  /** A child has started. */
  add(pid: number): void {
    this.live.add(pid);
    this.save();
  }

  /** A child has ended. */
  remove(pid: number): void {
    if (this.live.delete(pid)) this.save();
  }

  /** Settles when what was added and removed so far is on disk. */
  saved(): Promise<void> {
    return this.writing;
  }

  /** End the children of Teneos that are gone, and forget their files. How
   *  many were ended. A Teneo that still runs is left alone, and so is
   *  anything that is no longer a dns-sd. */
  async reapLeftovers(): Promise<number> {
    let names: string[];
    try {
      names = [];
      for await (const entry of await tjs.readDir(this.folder)) {
        names.push(entry.name);
      }
    } catch {
      return 0; // no folder yet: nothing was left
    }
    let ended = 0;
    for (const name of names) {
      const owner = ownerOfPidFile(name);
      if (owner === null || owner === this.ownerPid) continue;
      if ((await commandOf(owner)) !== "") continue; // it runs: not leftovers
      const path = `${this.folder}/${name}`;
      let pids: number[] = [];
      try {
        pids = parsePids(new TextDecoder().decode(await tjs.readFile(path)));
      } catch {
        // unreadable: forget the file all the same
      }
      for (const pid of pids) {
        if (!isDnsSdCommand(await commandOf(pid))) continue;
        try {
          tjs.kill(pid, "SIGTERM");
          ended += 1;
        } catch {
          // gone since it was looked at
        }
      }
      await tjs.remove(path).catch(() => {});
    }
    return ended;
  }

  private save(): void {
    this.writing = this.writing.then(() => this.write()).catch(() => {});
  }

  private async write(): Promise<void> {
    const path = `${this.folder}/${pidFileName(this.ownerPid)}`;
    if (this.live.size === 0) {
      await tjs.remove(path).catch(() => {});
      return;
    }
    await tjs.makeDir(this.folder, { recursive: true });
    await tjs.writeFile(path, formatPids(this.live));
  }
}

/** What the process with this pid is running, or "" if there is none. */
async function commandOf(pid: number): Promise<string> {
  try {
    const child = tjs.spawn(["/bin/ps", "-p", String(pid), "-o", "command="], {
      stdout: "pipe",
      stderr: "ignore",
      stdin: "ignore",
    });
    const output = await child.stdout!.text();
    await child.wait();
    return output.trim();
  } catch {
    return "";
  }
}
