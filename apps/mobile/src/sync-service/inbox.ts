// The page's side of PageInbox.java: native code queues each connection's
// opening, messages and end, and the page takes them, in order, through
// TeneoNative.nextEvent. A message arrives as the string it is, never as
// script to parse.

export type InboxEvent =
  | { kind: "opened"; connection: number; address: string; initiator: boolean }
  | { kind: "message"; connection: number; message: string }
  | { kind: "closed"; connection: number; reason: string };

/** One event as PageInbox writes it: a letter, the connection's number, a
 *  space, then what it carries. Null for anything else. */
export function readEvent(event: string): InboxEvent | null {
  const space = event.indexOf(" ");
  if (space < 2) return null;
  const digits = event.slice(1, space);
  if (!/^\d+$/.test(digits)) return null;
  const connection = Number(digits);
  const rest = event.slice(space + 1);
  switch (event[0]) {
    case "o":
      if (rest[0] !== "0" && rest[0] !== "1") return null;
      return {
        kind: "opened",
        connection,
        initiator: rest[0] === "1",
        address: rest.slice(1),
      };
    case "m":
      return { kind: "message", connection, message: rest };
    case "c":
      return { kind: "closed", connection, reason: rest };
    default:
      return null;
  }
}

/** Take every event waiting, handing each to `handle`. It goes on until the
 *  inbox is empty whatever happens to one, as native code says there is
 *  something to take only after the page has found it empty: an event left
 *  in it would wait for good. */
export function takeAll(
  next: () => string | null | undefined,
  handle: (event: InboxEvent) => void,
  onError: (error: unknown) => void,
): void {
  for (let text = next(); typeof text === "string"; text = next()) {
    const event = readEvent(text);
    if (!event) {
      onError(new Error(`native code queued "${text.slice(0, 16)}"`));
      continue;
    }
    try {
      handle(event);
    } catch (error) {
      onError(error);
    }
  }
}
