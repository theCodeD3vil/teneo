// ItemRecord: the one thing that crosses the wire. Each field has a merge rule
// that only ever moves one way (the later copy time, the larger pin stamp, the
// earlier delete), so merging is commutative, associative and idempotent and
// devices that exchange everything end up identical, in any order.
import { isDeviceId, isStamp } from "./hlc";

export const maxTextBytes = 1024 * 1024;
/** A larger image stays on the device that copied it. */
export const maxImageBytes = 16 * 1024 * 1024;
/** The kinds of image every device can show. Any other stays where it is. */
export const imageTypes = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];

/** What an image item says about its picture. The bytes travel apart from
 *  the record (the engine's blob frames), named by their hash. */
export interface ImageInfo {
  /** SHA-256 of the file, 64 hex digits */
  hash: string;
  bytes: number;
  width: number;
  height: number;
  /** One of imageTypes */
  type: string;
}

export interface Pin {
  /** When it was pinned, or null when this change is an unpin. */
  at: number | null;
  /** A Hlc stamp: the larger one wins. */
  stamp: string;
}

export interface ItemRecord {
  id: string;
  kind: "text" | "image";
  /** Null in a tombstone, and in an image. */
  text: string | null;
  /** Set in an image that is not deleted; null in a text and a tombstone. */
  image: ImageInfo | null;
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

const hashPattern = /^[0-9a-f]{64}$/;
const maxImageSide = 100_000;

const isSide = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value >= 1 &&
  value <= maxImageSide;

/** A clean copy of a record's image, or null when it is not one this version
 *  takes. */
function parseImage(input: unknown): ImageInfo | null {
  if (typeof input !== "object" || input === null) return null;
  const { hash, bytes, width, height, type } = input as Record<string, unknown>;
  if (typeof hash !== "string" || !hashPattern.test(hash)) return null;
  if (typeof bytes !== "number" || !Number.isSafeInteger(bytes)) return null;
  if (bytes < 1 || bytes > maxImageBytes) return null;
  if (!isSide(width) || !isSide(height)) return null;
  if (typeof type !== "string" || !imageTypes.includes(type)) return null;
  return { hash, bytes, width, height, type };
}

const isTime = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

/** A clean copy, or null when any field is missing, mistyped or out of range.
 *  Unknown fields are dropped. */
export function parseRecord(input: unknown): ItemRecord | null {
  if (typeof input !== "object" || input === null) return null;
  const r = input as Record<string, unknown>;
  if (typeof r.id !== "string" || !idPattern.test(r.id)) return null;
  if (r.kind !== "text" && r.kind !== "image") return null;
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
  let image: ImageInfo | null = null;
  if (r.kind === "image") {
    if (r.text !== null) return null; // an image carries no text
    if (r.deletedAt === null) {
      image = parseImage(r.image);
      if (!image) return null;
    }
  } else if (r.deletedAt === null) {
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
    kind: r.kind,
    text,
    image,
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
    a.kind === b.kind &&
    (a.text === null || b.text === null || a.text === b.text) &&
    (!a.image || !b.image || a.image.hash === b.image.hash)
  );
}

export function isSameRecord(a: ItemRecord, b: ItemRecord): boolean {
  return (
    a.text === b.text &&
    a.image?.hash === b.image?.hash &&
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
    kind: a.kind,
    text: deletedAt === null ? (a.text ?? b.text) : null,
    image: deletedAt === null ? (a.image ?? b.image ?? null) : null,
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

/** Whether two live items hold the same thing: the same text, or the same
 *  picture. */
export function hasSameContent(a: ItemRecord, b: ItemRecord): boolean {
  if (a.kind !== b.kind || isTombstone(a) || isTombstone(b)) return false;
  return a.kind === "text"
    ? a.text === b.text
    : Boolean(a.image) && a.image?.hash === b.image?.hash;
}

/** The same text (or picture) copied on two devices becomes one item: the one with the
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
    dropped: { ...drop, text: null, image: null, deletedAt },
  };
}
