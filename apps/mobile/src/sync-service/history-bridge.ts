import type { ClipboardLink, SecretSpan } from "@teneo/shared/types/clipboard";
// The phone's history as the page sees it: native code owns the database
// (HistoryStore.java) and the page asks through `TeneoNative`. Each call is
// one round trip with text in and text out, so every answer is JSON, and this
// is the one place that reads and writes it.
import type { PeerPatch, PeerRecord } from "@teneo/sync";

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
  /** The row's change number. Read, never written: native code hands out its own. */
  syncSeq: number;
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

  saveDetections(items: Detection[], version: number): void {
    unwrap(this.native.historySaveDetections(JSON.stringify(items), version));
  }
}
