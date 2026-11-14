/** Cuts text that arrives in pieces into whole lines. */
export class LineSplitter {
  private rest = "";

  /** The lines that `chunk` completes; the part after the last newline waits. */
  push(chunk: string): string[] {
    const lines = (this.rest + chunk).split(/\r?\n/);
    this.rest = lines.pop() ?? "";
    return lines;
  }
}
