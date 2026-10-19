import { logError } from "./files";

/** Run a command and return its trimmed output, or "" if it fails. */
export async function runCommand(command: string[]): Promise<string> {
  try {
    const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
    // read until the stream ends: a full, unread pipe would block the command forever
    // stdout is only null when it isn't piped, and it is here
    const reader = child.stdout!.getReader();
    // one decoder per call: in stream mode it holds a split UTF-8 character
    // between chunks, which concurrent calls must not share
    const textDecoder = new TextDecoder();
    let output = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      output += textDecoder.decode(value, { stream: true });
    }
    output += textDecoder.decode(); // flush the bytes of a character cut off at the end
    const exit = await child.wait();
    return exit.exit_status === 0 ? output.trim() : "";
  } catch (error) {
    // e.g. the process couldn't start (too many open files): logged, so the gap isn't silent
    logError(`${command[0]} failed to run:`, error);
    return "";
  }
}
