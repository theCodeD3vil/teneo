// How the release scripts run gh. A shell's `gh` is often a function, such as
// 1Password's shell plugin (`op plugin run -- gh`), which a script's child
// process never sees: it gets the bare binary, signed in or not. So: gh on its
// own when it is signed in, else through 1Password's plugin, with the token
// the shell's gh uses. TENEO_GH=gh or TENEO_GH=op picks one.
import { spawnSync } from "node:child_process";

const throughOnePassword = ["op", "plugin", "run", "--", "gh"];
let command: string[] | null = null;

/** The words that run gh, before its own arguments. */
export function ghCommand(): string[] {
  if (command) return command;
  const choice = process.env.TENEO_GH;
  if (choice === "gh") command = ["gh"];
  else if (choice === "op") command = throughOnePassword;
  else {
    const own = spawnSync("gh", ["auth", "status"], { stdio: "ignore" });
    command = own.status === 0 ? ["gh"] : throughOnePassword;
  }
  return command;
}

/** spawnSync's command and arguments for `gh ...args`. */
export function ghArgs(args: string[]): [string, string[]] {
  const [first, ...rest] = ghCommand();
  return [first!, [...rest, ...args]];
}
