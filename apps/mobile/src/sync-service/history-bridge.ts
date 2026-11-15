import type { ClipboardLink, SecretSpan } from "@teneo/shared/types/clipboard";
// The phone's history as the page sees it: native code owns the database
// (HistoryStore.java) and the page asks through `TeneoNative`. Each call is
// one round trip with text in and text out, so every answer is JSON, and this
// is the one place that reads and writes it.
import {
  fromBase64,
  type ImageStore,
  type PeerPatch,
  type PeerRecord,
  toBase64,
} from "@teneo/sync";

/** The calls native code answers (SyncStoreBridge.java). An answer is
 *  `{"v": value}`, or `{"error": why}`; none of them throws. */
export interface NativeHistory {
  historyDeviceId(): string;
  historyEpoch(): string;
  /** Rows with a change number above `after`, at most `limit`, and the highest
   *  change number, from one moment. May hold fewer rows than asked, with
   *  `capped`, to keep an answer small. */
  historyChangesAfter(after: number, limit: number): string;
  /** One row, deleted or not, and the highest change number then */
  historyRow(id: string): string;
  /** The newest unpinned live row except those ids (a JSON array), and the
   *  highest change number then */
  historyNewestUnpinned(skipped: string): string;
  historyPeer(deviceId: string): string;
  historyLatestStamp(): string;
  /** Save a `WireBatch` (as JSON) all at once. false: nothing was saved,
   *  because the history changed since `expectedHead` was read. */
  historyCommit(batch: string): string;
  /** Apply the history limits */
  historyTrim(): string;
  /** Store what detection found in texts, for rules of this version */
  historySaveDetections(detections: string, version: number): string;
  /** The hashes of the images whose bytes the phone lacks, a JSON array */
  imagesMissing(): string;
  /** How long the image with this hash is, or null when the phone lacks it */
  imageSize(hash: string): string;
  /** A piece of it in base64, or null */
  imageRead(hash: string, offset: number, length: number): string;
  /** Keep a piece (base64) of an image that is arriving: "more", "done" or
   *  "refused" (HistoryStore.imageWrite) */
  imageWrite(
    hash: string,
    offset: number,
    total: number,
    piece: string,
  ): string;
  /** Debug builds only: a copy made on this phone, as the capture saves one */
  debugSaveText(text: string): string;
}

/** A text row as native code reads and writes it: the table's own columns */
export interface WireRow {
  id: string;
  /** null in a tombstone, and for a text too long for sync to send */
  value: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pinnedStamp: string | null;
  deletedAt: number | null;
  createdAt: number | null;
  originDevice: string | null;
  /** JSON of the secrets found in the text, or null for none */
  secrets: string | null;
  linkUrl: string | null;
  linkHost: string | null;
  /** which detection rules found the secrets and link; null if none looked */
  detectorVersion: number | null;
  /** the text itself when it is exactly one CSS colour; found with the rest */
  color?: string | null;
  /** The row's change number. Read, never written: native code hands out its own. */
  syncSeq: number;
  /** "image" for an image; a text when absent */
  kind?: "text" | "image";
  /** An image's width and height as JSON, and what a record says of its
   *  bytes: their SHA-256, how many, and their kind. Null or absent in a text
   *  and in a tombstone. */
  imageSize?: string | null;
  imageHash?: string | null;
  imageBytes?: number | null;
  imageType?: string | null;
}

/** What one sync transaction wrote, to save at once */
export interface WireBatch {
  /** The highest change number when the transaction first read; null when
   *  what it writes doesn't depend on a read */
  expectedHead: number | null;
  puts: WireRow[];
  peers: Record<string, PeerPatch>;
}

export interface Detection {
  id: string;
  secrets: SecretSpan[];
  link: ClipboardLink | null;
  color: string | null;
}

interface Answer<T> {
  v?: T;
  error?: string;
}

function unwrap<T>(text: string): T {
  const answer = JSON.parse(text) as Answer<T>;
  if (answer.error !== undefined) throw new Error(answer.error);
  return answer.v as T;
}

export class HistoryBridge {
  private readonly native: NativeHistory;

  constructor(native: NativeHistory) {
    this.native = native;
  }

  deviceId(): string {
    return unwrap(this.native.historyDeviceId());
  }

  epoch(): string {
    return unwrap(this.native.historyEpoch());
  }

  changesAfter(
    after: number,
    limit: number,
  ): { rows: WireRow[]; head: number; capped: boolean } {
    return unwrap(this.native.historyChangesAfter(after, limit));
  }

  row(id: string): { row: WireRow | null; head: number } {
    return unwrap(this.native.historyRow(id));
  }

  newestUnpinned(skipped: string[]): { row: WireRow | null; head: number } {
    return unwrap(this.native.historyNewestUnpinned(JSON.stringify(skipped)));
  }

  peer(deviceId: string): PeerRecord | null {
    return unwrap(this.native.historyPeer(deviceId));
  }

  latestStamp(): string | null {
    return unwrap(this.native.historyLatestStamp());
  }

  /** Whether it was saved: false when the history changed meanwhile */
  commit(batch: WireBatch): boolean {
    return unwrap(this.native.historyCommit(JSON.stringify(batch)));
  }

  trim(): void {
    unwrap(this.native.historyTrim());
  }

  /** The bytes of the history's images, as the sync engine asks for them */
  readonly images: ImageStore = {
    missing: async () => unwrap<string[]>(this.native.imagesMissing()),
    size: async (hash) => unwrap<number | null>(this.native.imageSize(hash)),
    read: async (hash, offset, length) => {
      const piece = unwrap<string | null>(
        this.native.imageRead(hash, offset, length),
      );
      return piece === null ? null : fromBase64(piece);
    },
    write: async (hash, offset, total, piece) =>
      unwrap<"more" | "done" | "refused">(
        this.native.imageWrite(hash, offset, total, toBase64(piece)),
      ),
  };

  saveDetections(items: Detection[], version: number): void {
    unwrap(this.native.historySaveDetections(JSON.stringify(items), version));
  }
}
