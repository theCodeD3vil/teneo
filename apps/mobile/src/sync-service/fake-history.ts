// The native side of history-bridge.ts, in memory, for tests: the phone's
// database as HistoryStore.java keeps it. It answers in the same JSON, counts
// changes the same way (every write takes the next syncSeq), reads each answer
// from one moment, and refuses a batch when the history changed since it was
// read. It also does what the app does to the history (a copy, a pin, a
// delete), so a test can change things from "the other side of the bridge".
import { Hlc } from "@teneo/sync";

import type { NativeHistory, WireBatch, WireRow } from "./history-bridge";

const maxTextBytes = 1024 * 1024;
const peerFields = [
  "name",
  "platform",
  "epoch",
  "receivedSeq",
  "lastAddress",
  "lastSeenAt",
];

interface PeerRow {
  deviceId: string;
  name: string;
  platform: string;
  epoch: string | null;
  receivedSeq: number;
  lastAddress: string | null;
  lastSeenAt: number;
}

const bytes = (text: string) => new TextEncoder().encode(text).length;
const ok = (value: unknown) => JSON.stringify({ v: value ?? null });

export class FakeHistory implements NativeHistory {
  readonly deviceId: string;
  readonly epoch: string;
  /** Rows by id, as the table has them */
  readonly rows = new Map<string, WireRow>();
  readonly peers = new Map<string, PeerRow>();
  /** The pin stamps the history's clock was told of by saved batches */
  readonly observed: string[] = [];
  /** The detections that were stored, by call */
  readonly detectionCalls: { ids: string[]; version: number }[] = [];
  trims = 0;
  /** How many rows saved batches have written */
  putsSaved = 0;
  /** Stop an answer of changesAfter once its texts add up to this many characters */
  maxChars = Number.POSITIVE_INFINITY;
  /** Called with each change to the rows, as HistoryStore's listeners are */
  readonly listeners = new Set<() => void>();
  /** Called after each call, to make the app change the history at that moment */
  beforeCommit: (() => void) | null = null;
  commitCalls = 0;

  private seq = 0;
  private readonly clock: Hlc;
  private readonly now: () => number;
  private idCounter = 0;

  constructor(deviceId: string, now: () => number, epoch = "e".repeat(16)) {
    this.deviceId = deviceId;
    this.epoch = epoch;
    this.now = now;
    this.clock = new Hlc(deviceId, now);
  }

  // --- what the app does to the history (HistoryStore.saveText and the rest)

  /** The same text as the newest unpinned item bumps that one, as the app does */
  copy(
    text: string,
    options: { id?: string; sourceApp?: string } = {},
  ): string {
    const newest = this.newestUnpinned([]);
    const time = this.now();
    if (newest && newest.value === text && !options.id) {
      this.write({
        ...newest,
        dateCopied: Math.max(newest.dateCopied, time),
        sourceAppName: options.sourceApp ?? null,
      });
      return newest.id;
    }
    const id = options.id ?? `phone-${++this.idCounter}`;
    // a copy is saved without looking for secrets: the app does that later
    this.write({
      id,
      value: text,
      dateCopied: time,
      sourceAppName: options.sourceApp ?? null,
      sourceAppBundleId: null,
      pinnedAt: null,
      pinnedStamp: null,
      deletedAt: null,
      createdAt: time,
      originDevice: this.deviceId,
      secrets: null,
      linkUrl: null,
      linkHost: null,
      detectorVersion: null,
      syncSeq: 0,
    });
    return id;
  }

  pin(id: string, pinned: boolean): void {
    const row = this.rows.get(id);
    if (!row || row.deletedAt !== null) return;
    // an unpin gets a stamp too: it has to win over the pin it undoes
    this.write({
      ...row,
      pinnedAt: pinned ? this.now() : null,
      pinnedStamp: this.clock.next(),
    });
  }

  remove(id: string): void {
    const row = this.rows.get(id);
    if (!row || row.deletedAt !== null) return;
    this.write({
      ...row,
      value: null,
      secrets: null,
      linkUrl: null,
      linkHost: null,
      pinnedAt: null,
      deletedAt: this.now(),
    });
  }

  /** What the app shows: the texts of the rows that are not deleted */
  liveTexts(): string[] {
    return [...this.rows.values()].flatMap((row) =>
      row.deletedAt === null ? [row.value!] : [],
    );
  }

  get head(): number {
    return this.seq;
  }

  private write(row: WireRow): void {
    this.rows.set(row.id, { ...row, syncSeq: ++this.seq });
    for (const listener of this.listeners) listener();
  }

  private newestUnpinned(skipped: string[]): WireRow | null {
    const candidates = [...this.rows.values()].filter(
      (row) =>
        row.deletedAt === null &&
        row.pinnedAt === null &&
        !skipped.includes(row.id),
    );
    candidates.sort((a, b) =>
      a.dateCopied !== b.dateCopied
        ? b.dateCopied - a.dateCopied
        : a.id < b.id
          ? 1
          : -1,
    );
    return candidates[0] ?? null;
  }

  /** What a read returns: a text sync can't send is not read */
  private read(row: WireRow | null | undefined): WireRow | null {
    if (!row) return null;
    return row.value !== null && bytes(row.value) > maxTextBytes
      ? { ...row, value: null }
      : { ...row };
  }

  // --- NativeHistory

  historyDeviceId(): string {
    return ok(this.deviceId);
  }

  historyEpoch(): string {
    return ok(this.epoch);
  }

  historyChangesAfter(after: number, limit: number): string {
    const rows: WireRow[] = [];
    let capped = false;
    let chars = 0;
    const next = [...this.rows.values()]
      .filter((row) => row.syncSeq > after)
      .sort((a, b) => a.syncSeq - b.syncSeq)
      .slice(0, Math.max(1, limit));
    for (const stored of next) {
      const row = this.read(stored)!;
      rows.push(row);
      chars += row.value?.length ?? 0;
      if (chars >= this.maxChars && rows.length < Math.max(1, limit)) {
        capped = true;
        break;
      }
    }
    return ok({ rows, head: this.seq, capped });
  }

  historyRow(id: string): string {
    return ok({ row: this.read(this.rows.get(id)), head: this.seq });
  }

  historyNewestUnpinned(skipped: string): string {
    const row = this.newestUnpinned(JSON.parse(skipped) as string[]);
    return ok({ row: this.read(row), head: this.seq });
  }

  historyPeer(deviceId: string): string {
    return ok(this.peers.get(deviceId) ?? null);
  }

  historyLatestStamp(): string {
    const stamps = [...this.rows.values()].flatMap((row) =>
      row.pinnedStamp ? [row.pinnedStamp] : [],
    );
    return ok(stamps.sort().at(-1) ?? null);
  }

  historyCommit(text: string): string {
    this.commitCalls += 1;
    this.beforeCommit?.();
    const batch = JSON.parse(text) as WireBatch;
    if (batch.expectedHead !== null && batch.expectedHead !== this.seq) {
      return ok(false);
    }
    // all or nothing: a refused patch leaves everything as it was
    for (const patch of Object.values(batch.peers)) {
      for (const field of Object.keys(patch)) {
        if (!peerFields.includes(field)) {
          return JSON.stringify({
            error:
              "IllegalArgumentException: A device has no field of that name",
          });
        }
      }
    }
    const saved = new Map(this.rows);
    const savedSeq = this.seq;
    try {
      for (const put of batch.puts) {
        this.putsSaved += 1;
        if (put.pinnedStamp) {
          this.clock.observe(put.pinnedStamp);
          this.observed.push(put.pinnedStamp);
        }
        const existing = this.rows.get(put.id);
        this.rows.set(
          put.id,
          existing
            ? {
                ...existing,
                value: put.value,
                dateCopied: put.dateCopied,
                sourceAppName: put.sourceAppName,
                sourceAppBundleId: put.sourceAppBundleId,
                pinnedAt: put.pinnedAt,
                pinnedStamp: put.pinnedStamp,
                deletedAt: put.deletedAt,
                secrets: put.secrets,
                linkUrl: put.linkUrl,
                linkHost: put.linkHost,
                detectorVersion: put.detectorVersion,
                syncSeq: ++this.seq,
              }
            : { ...put, syncSeq: ++this.seq },
        );
      }
    } catch (error) {
      this.rows.clear();
      for (const [id, row] of saved) this.rows.set(id, row);
      this.seq = savedSeq;
      throw error;
    }
    for (const [deviceId, patch] of Object.entries(batch.peers)) {
      const known = this.peers.get(deviceId) ?? {
        deviceId,
        name: "",
        platform: "",
        epoch: null,
        receivedSeq: 0,
        lastAddress: null,
        lastSeenAt: 0,
      };
      this.peers.set(deviceId, { ...known, ...patch });
    }
    if (batch.puts.length > 0)
      for (const listener of this.listeners) listener();
    return ok(true);
  }

  historyTrim(): string {
    this.trims += 1;
    return ok(true);
  }

  historySaveDetections(text: string, version: number): string {
    const items = JSON.parse(text) as {
      id: string;
      secrets: { start: number; end: number; label: string }[];
      link: { url: string; host: string } | null;
    }[];
    this.detectionCalls.push({ ids: items.map((item) => item.id), version });
    for (const item of items) {
      const row = this.rows.get(item.id);
      if (!row || row.value === null) continue;
      // no new syncSeq: what was found is not news for the other devices
      this.rows.set(item.id, {
        ...row,
        secrets: item.secrets.length > 0 ? JSON.stringify(item.secrets) : null,
        linkUrl: item.link?.url ?? null,
        linkHost: item.link?.host ?? null,
        detectorVersion: version,
      });
    }
    return ok(true);
  }

  debugSaveText(text: string): string {
    return ok(this.copy(text));
  }
}
