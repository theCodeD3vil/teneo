// What a Teneo that is killed outright leaves behind: its `dns-sd` children,
// which go on announcing a port nobody listens on. Each Teneo notes the pids of
// its children in a file of its own; the next one ends the children of files
// whose Teneo is gone, and only those. These are the parts that need no runtime.

const filePrefix = "bonjour-";
const fileSuffix = ".pids";

/** The name of the file the Teneo with this pid keeps its children's pids in. */
export function pidFileName(ownerPid: number): string {
  return `${filePrefix}${ownerPid}${fileSuffix}`;
}

/** The Teneo a file name belongs to, or null if it isn't one of these files. */
export function ownerOfPidFile(name: string): number | null {
  const match = /^bonjour-(\d+)\.pids$/.exec(name);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

export function formatPids(pids: Iterable<number>): string {
  return [...pids].map((pid) => `${pid}\n`).join("");
}

/** The pids in a file: one per line; anything else, and repeats, are dropped. */
export function parsePids(text: string): number[] {
  const pids = new Set<number>();
  for (const line of text.split("\n")) {
    if (!/^\d+$/.test(line.trim())) continue;
    const pid = Number(line);
    if (Number.isSafeInteger(pid) && pid > 0) pids.add(pid);
  }
  return [...pids];
}

/** Whether what `ps -o command=` printed is a dns-sd: a pid is handed to some
 *  other program once its process ends, and that one must be left alone. */
export function isDnsSdCommand(psOutput: string): boolean {
  const program = psOutput.trim().split(/\s+/)[0] ?? "";
  return program.split("/").pop() === "dns-sd";
}
