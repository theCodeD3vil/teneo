// ItemRecord: the one thing that crosses the wire. Each field has a merge rule
// that only ever moves one way (the later copy time, the larger pin stamp, the
// earlier delete), so merging is commutative, associative and idempotent and
// devices that exchange everything end up identical, in any order.
import { isDeviceId, isStamp } from "./hlc";

export const maxTextBytes = 1024 * 1024;

export interface Pin {
  /** When it was pinned, or null when this change is an unpin. */
  at: number | null;
  /** A Hlc stamp: the larger one wins. */
  stamp: string;
}

export interface ItemRecord {
  id: string;
  kind: "text";
  /** Null in a tombstone. */
  text: string | null;
  createdAt: number;
  /** The device that first copied it. */
  origin: string;
  dateCopied: number;
  sourceApp: string | null;
  /** Null: never pinned or unpinned since sync began. */
  pinned: Pin | null;
  /** Once set it stays set, and the text is dropped. */
  deletedAt: number | null;
}

// A deleted item is never pinned: its pin keeps only the stamp, so two devices
// that hold the same stamp cannot disagree about when it was pinned.
function withoutPinTime(pin: Pin | null): Pin | null {
  return pin && pin.at !== null ? { at: null, stamp: pin.stamp } : pin;
}

export const isTombstone = (record: ItemRecord): boolean =>
  record.deletedAt !== null;

/** UTF-8 size without allocating: the limits are in bytes. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4; // a surrogate pair is one 4-byte character
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

// --- validation: a record from a peer is untrusted input

const idPattern = /^[A-Za-z0-9_-]{1,64}$/;
const maxSourceAppLength = 256;

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A clean copy, or null when any field is missing, mistyped or out of range.
 *  Unknown fields are dropped. */
export function parseRecord(input: unknown): ItemRecord | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== "string" || !idPattern.test(r.id)) return null;
  if (r.kind !== "text") return null;
  if (!isTime(r.createdAt) || !isTime(r.dateCopied)) return null;
  if (!isDeviceId(r.origin)) return null;
  // never empty: null means none, and the merge treats the two as different
  if (
    r.sourceApp !== null &&
    !(
      typeof r.sourceApp === "string" &&
      r.sourceApp.length >= 1 &&
      r.sourceApp.length <= maxSourceAppLength
    )
  ) {
    return null;
  }
  if (r.deletedAt !== null && !isTime(r.deletedAt)) return null;

  let text: string | null = null;
  if (r.deletedAt === null) {
    if (typeof r.text !== "string" || utf8Length(r.text) > maxTextBytes)
      return null;
    text = r.text;
  } else if (r.text !== null) {
    return null; // a tombstone carries no text
  }

  let pinned: Pin | null = null;
  if (r.pinned !== null) {
    if (typeof r.pinned !== "object" || r.pinned === undefined) return null;
    const pin = r.pinned as Record<string, unknown>;
    if (!isStamp(pin.stamp)) return null;
    if (pin.at !== null && !isTime(pin.at)) return null;
    pinned = { at: pin.at, stamp: pin.stamp };
    if (r.deletedAt !== null) pinned = withoutPinTime(pinned);
  }

  return {
    id: r.id,
    kind: "text",
    text,
    createdAt: r.createdAt,
    origin: r.origin,
    dateCopied: r.dateCopied,
    sourceApp: r.sourceApp,
    pinned,
    deletedAt: r.deletedAt,
  };
}

// --- merge

/** Whether two records are the same item: the fields that never change agree. */
export function isSameItem(a: ItemRecord, b: ItemRecord): boolean {
  return (
    a.id === b.id &&
    a.createdAt === b.createdAt &&
    a.origin === b.origin &&
    (a.text === null || b.text === null || a.text === b.text)
  );
}

export function isSameRecord(a: ItemRecord, b: ItemRecord): boolean {
  return (
    a.text === b.text &&
    a.dateCopied === b.dateCopied &&
    a.sourceApp === b.sourceApp &&
    a.deletedAt === b.deletedAt &&
    a.pinned?.stamp === b.pinned?.stamp &&
    a.pinned?.at === b.pinned?.at &&
    isSameItem(a, b)
  );
}

// The later copy wins and brings its source app. A tie goes to the larger app
// name (null is smallest), so the result never depends on argument order.
function laterCopy(a: ItemRecord, b: ItemRecord): ItemRecord {
  if (a.dateCopied !== b.dateCopied) return a.dateCopied > b.dateCopied ? a : b;
  return (a.sourceApp ?? "") >= (b.sourceApp ?? "") ? a : b;
}

function earlierDelete(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return Math.min(a, b);
}

function newerPin(a: Pin | null, b: Pin | null): Pin | null {
  if (a === null) return b;
  if (b === null) return a;
  return a.stamp >= b.stamp ? a : b;
}

/** Combine two versions of one item. Both must be the same item (isSameItem). */
export function mergeRecords(a: ItemRecord, b: ItemRecord): ItemRecord {
  const copy = laterCopy(a, b);
  const deletedAt = earlierDelete(a.deletedAt, b.deletedAt);
  return {
    id: a.id,
    kind: "text",
    text: deletedAt === null ? (a.text ?? b.text) : null,
    createdAt: a.createdAt,
    origin: a.origin,
    dateCopied: copy.dateCopied,
    sourceApp: copy.sourceApp,
    pinned:
      deletedAt === null
        ? newerPin(a.pinned, b.pinned)
        : withoutPinTime(newerPin(a.pinned, b.pinned)),
    deletedAt,
  };
}

/** The same text copied on two devices becomes one item: the one with the
 *  smaller id stays, with the later copy time, and the other is deleted. Both
 *  results are ordinary records, so every device reaches the same state. */
export function collapseSameText(
  a: ItemRecord,
  b: ItemRecord,
  deletedAt: number,
): { kept: ItemRecord; dropped: ItemRecord } {
  const [keep, drop] = a.id < b.id ? [a, b] : [b, a];
  const copy = laterCopy(a, b);
  return {
    kept: { ...keep, dateCopied: copy.dateCopied, sourceApp: copy.sourceApp },
    dropped: { ...drop, text: null, deletedAt },
  };
}
