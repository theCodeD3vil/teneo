// The model can suggest this action, but it never supplies what gets copied.
export function findErrorLine(text: string): string | null {
  if (text.length > 4096) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim());
  if (
    !lines.some((line) =>
      /^(?:at\s+(?:\S+ )?\(?.+:\d+(?::\d+)?\)?$|File ".+", line \d+(?:,|$))/i.test(
        line,
      ),
    )
  )
    return null;
  return (
    lines.find((line) =>
      /^(?:[\w.]*?(?:Error|Exception)|panic):\s+\S/.test(line),
    ) ?? null
  );
}
