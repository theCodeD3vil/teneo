const textDecoder = new TextDecoder();

/** Run a command and return its trimmed output, or "" if it fails. */
export async function runCommand(command: string[]): Promise<string> {
  const child = tjs.spawn(command, { stdout: "pipe", stderr: "ignore" });
  // read until the stream ends: a full, unread pipe would block the command forever
  const reader = child.stdout.getReader();
  let output = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    output += textDecoder.decode(value, { stream: true });
  }
  const exit = await child.wait();
  return exit.exit_status === 0 ? output.trim() : "";
}
