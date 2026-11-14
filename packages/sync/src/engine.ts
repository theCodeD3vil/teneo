// SyncEngine: keeps this device's history level with every device that holds
// the same vault key, over whatever Channels a transport gives it.
//
// Each device numbers its own writes (syncSeq). To a peer it sends every
// eligible row above the number that peer last read, in batches, then new
// changes as they happen. What a device applies from a peer is stamped with a
// new syncSeq of its own, so it travels on to other peers (a phone can get one
// Mac's items from another). A merge that changes nothing writes nothing, which
// is what ends the echo.
import type { Channel } from "./channel";
import { type VaultKeys, deriveVaultKeys, type Bytes } from "./crypto";
import type { Hlc } from "./hlc";
import { batchLimits, type ChangesFrame, type StateFrame } from "./protocol";
import {
  type ItemRecord,
  collapseSameText,
  isSameItem,
  isSameRecord,
  isTombstone,
  maxTextBytes,
  mergeRecords,
  parseRecord,
  utf8Length,
} from "./record";
import { type Scheduler, Session, SyncError } from "./session";
import type { StoredChange, SyncStore, SyncTransaction } from "./store";

export interface EngineOptions {
  /** 32 hex digits, made once per device. */
  deviceId: string;
  /** Shown to the other devices: the computer's name. */
  name: string;
  platform: string;
  vaultKey: Bytes;
  store: SyncStore;
  /** Items holding detected secrets travel only while this says true. */
  syncSecrets?: () => boolean;
  /** Learns every pin stamp that arrives, so a pin made here afterwards wins. */
  clock?: Hlc;
  now?: () => number;
  scheduler?: Scheduler;
  /** Received changes changed the local history. */
  onItemsChanged?: () => void;
  onPeersChanged?: () => void;
  /** A connection failed because of something on this device. */
  onError?: (error: unknown) => void;
}

export interface ConnectedPeer {
  deviceId: string;
  name: string;
  platform: string;
  address: string | undefined;
}

// How many rows one read of the store asks for
const scanPage = batchLimits.items;

interface Link {
  session: Session;
  peerId: string;
  name: string;
  platform: string;
  /** The peer's store epoch: null until its state frame arrives. */
  epoch: string | null;
  /** The peer has everything up to here. Null until its state frame arrives. */
  sentUpTo: number | null;
  pumping: boolean;
  dirty: boolean;
}

export class SyncEngine {
  private readonly options: EngineOptions;
  private readonly keys: Promise<VaultKeys>;
  private readonly links = new Map<string, Link>();
  private ownEpoch: Promise<string> | null = null;
  private clockSeeded: Promise<void> | null = null;
  private attaching = 0;
  private stopped = false;

  constructor(options: EngineOptions) {
    this.options = options;
    this.keys = deriveVaultKeys(options.vaultKey);
  }

  /** What devices of this vault announce and look for, so others are ignored. */
  async discoveryTag(): Promise<string> {
    return (await this.keys).tag;
  }

  /** Run a connection from a transport, whichever side opened it. Settles when
   *  it ends: with the error that ended it, or null when this side closed it. */
  async attach(channel: Channel): Promise<SyncError | null> {
    this.attaching += 1;
    let session: Session | null = null;
    let link: Link | null = null;
    try {
      if (this.stopped) throw new SyncError("closed", "Sync is off");
      const keys = await this.keys;
      await this.seedClock();
      session = await Session.open(channel, {
        deviceId: this.options.deviceId,
        authKey: keys.authKey,
        scheduler: this.options.scheduler,
        now: this.options.now,
      });
      link = await this.register(session);
    } catch (error) {
      session?.close();
      channel.close();
      return error instanceof SyncError
        ? error
        : new SyncError(
            "failed",
            `Starting a connection failed: ${String(error)}`,
          );
    } finally {
      this.attaching -= 1;
    }

    const ended = await session.closed;
    if (link && this.links.get(link.peerId) === link) {
      this.links.delete(link.peerId);
      this.options.onPeersChanged?.();
    }
    return ended;
  }

  /** Tell the engine this device wrote to its history, or changed what may sync. */
  localChanged(): void {
    for (const link of this.links.values()) this.pump(link);
  }

  peers(): ConnectedPeer[] {
    return [...this.links.values()]
      .filter((link) => link.epoch !== null)
      .map((link) => ({
        deviceId: link.peerId,
        name: link.name,
        platform: link.platform,
        address: link.session.remoteAddress,
      }));
  }

  stop(): void {
    this.stopped = true;
    for (const link of this.links.values()) link.session.close();
  }

  /** Nothing is connecting, being read or being sent. For tests. */
  isIdle(): boolean {
    return (
      this.attaching === 0 &&
      [...this.links.values()].every(
        (link) => !link.pumping && link.session.idle(),
      )
    );
  }

  // --- connections

  private now(): number {
    return (this.options.now ?? Date.now)();
  }

  private epoch(): Promise<string> {
    this.ownEpoch ??= this.options.store.epoch();
    return this.ownEpoch;
  }

  private seedClock(): Promise<void> {
    this.clockSeeded ??= this.options.store.latestStamp().then((stamp) => {
      if (stamp) this.options.clock?.observe(stamp);
    });
    return this.clockSeeded;
  }

  /** Whether the new connection should replace the one already open to this
   *  peer. Both devices apply the same rule, so both keep the same one. */
  private prefersNew(fresh: Session, existing: Session): boolean {
    const initiatorOf = (session: Session) =>
      session.initiator ? this.options.deviceId : session.peerId;
    const [freshId, existingId] = [initiatorOf(fresh), initiatorOf(existing)];
    return freshId === existingId ? true : freshId < existingId;
  }

  private async register(session: Session): Promise<Link | null> {
    const existing = this.links.get(session.peerId);
    if (existing) {
      if (!this.prefersNew(session, existing.session)) {
        session.close();
        return null;
      }
      existing.session.close();
    }
    const link: Link = {
      session,
      peerId: session.peerId,
      name: "",
      platform: "",
      epoch: null,
      sentUpTo: null,
      pumping: false,
      dirty: false,
    };
    this.links.set(link.peerId, link);
    session.onFrame((frame) => this.handleFrame(link, frame));

    const known = await this.options.store.getPeer(link.peerId);
    await session.send({
      t: "state",
      epoch: await this.epoch(),
      name: this.options.name,
      platform: this.options.platform,
      cursor: { epoch: known?.epoch ?? null, seq: known?.receivedSeq ?? 0 },
    });
    return link;
  }

  // --- receiving

  private async handleFrame(
    link: Link,
    frame: StateFrame | ChangesFrame,
  ): Promise<void> {
    if (frame.t === "state") await this.handleState(link, frame);
    else await this.handleChanges(link, frame);
  }

  private async handleState(link: Link, frame: StateFrame): Promise<void> {
    if (link.epoch !== null) {
      throw new SyncError("protocol", "The other device sent its state twice");
    }
    link.epoch = frame.epoch;
    link.name = frame.name;
    link.platform = frame.platform;
    // a cursor into another store, or into one this device has since replaced,
    // means nothing: start from the beginning
    link.sentUpTo =
      frame.cursor.epoch === (await this.epoch()) ? frame.cursor.seq : 0;

    const address = link.session.remoteAddress;
    await this.options.store.transaction((tx) =>
      tx.updatePeer(link.peerId, {
        name: frame.name,
        platform: frame.platform,
        lastSeenAt: this.now(),
        ...(address ? { lastAddress: address } : {}),
      }),
    );
    this.options.onPeersChanged?.();
    this.pump(link);
  }

  private async handleChanges(link: Link, frame: ChangesFrame): Promise<void> {
    if (link.epoch === null || frame.epoch !== link.epoch) {
      throw new SyncError(
        "protocol",
        "Changes came before the state, or from another store",
      );
    }
    const records: ItemRecord[] = [];
    for (const item of frame.items) {
      const record = parseRecord(item);
      if (record) records.push(record);
    }

    const { store } = this.options;
    // the batch and the cursor are saved together: after a crash the next
    // connection resumes at the last batch that was fully applied
    const changed = await store.transaction(async (tx) => {
      let changed = false;
      for (const record of records) {
        if (record.pinned) this.options.clock?.observe(record.pinned.stamp);
        changed = (await this.applyRecord(tx, record)) || changed;
      }
      await tx.updatePeer(link.peerId, {
        epoch: frame.epoch,
        receivedSeq: frame.upTo,
        lastSeenAt: this.now(),
      });
      return changed;
    });
    if (!changed) return;

    await store.trimHistory();
    this.options.onItemsChanged?.();
    for (const other of this.links.values()) this.pump(other);
  }

  /** Whether the record changed this device's history. */
  private async applyRecord(
    tx: SyncTransaction,
    incoming: ItemRecord,
  ): Promise<boolean> {
    const local = await tx.get(incoming.id);
    if (local) {
      if (!isSameItem(local, incoming)) return false; // the id belongs to another item
      const merged = mergeRecords(local, incoming);
      if (isSameRecord(merged, local)) return false;
      await tx.put(merged);
      return true;
    }

    // The same text copied on two devices: one item, not two. A pinned item
    // is left alone, so nothing is ever unpinned by this.
    const isPlainCopy =
      !isTombstone(incoming) &&
      (incoming.pinned === null || incoming.pinned.at === null);
    const newest = isPlainCopy ? await tx.newestUnpinned() : null;
    if (newest && newest.text === incoming.text) {
      const { kept, dropped } = collapseSameText(newest, incoming, this.now());
      for (const record of [kept, dropped]) {
        if (record.id !== newest.id || !isSameRecord(record, newest))
          await tx.put(record);
      }
      return true;
    }

    await tx.put(incoming); // a tombstone for an item not seen here is stored too
    return true;
  }

  // --- sending

  private pump(link: Link): void {
    link.dirty = true;
    if (link.pumping || link.sentUpTo === null) return;
    link.pumping = true;
    void (async () => {
      try {
        while (link.dirty) {
          link.dirty = false;
          await this.sendChanges(link);
        }
      } catch (error) {
        // a connection that closed mid-send is an ordinary disconnect
        if (!(error instanceof SyncError && error.code === "closed")) {
          this.options.onError?.(error);
        }
        link.session.close();
      } finally {
        link.pumping = false;
      }
    })();
  }

  private isEligible(change: StoredChange, allowSecrets: boolean): boolean {
    const { record } = change;
    if (isTombstone(record)) return true;
    if (change.hasSecret && !allowSecrets) return false;
    return utf8Length(record.text!) <= maxTextBytes;
  }

  /** Send everything the peer has not read, a batch at a time. */
  private async sendChanges(link: Link): Promise<void> {
    const { store } = this.options;
    const epoch = await this.epoch();
    const allowSecrets = this.options.syncSecrets?.() ?? false;

    while (link.sentUpTo !== null) {
      const items: ItemRecord[] = [];
      let bytes = 0;
      let scanned = link.sentUpTo;
      let more = false;

      scan: while (true) {
        const { changes, head } = await store.changesAfter(scanned, scanPage);
        for (const change of changes) {
          if (this.isEligible(change, allowSecrets)) {
            const size = utf8Length(change.record.text ?? "") + 256;
            const full =
              items.length >= batchLimits.items ||
              (items.length > 0 && bytes + size > batchLimits.bytes);
            if (full) {
              more = true;
              break scan;
            }
            items.push(change.record);
            bytes += size;
          }
          scanned = change.seq;
        }
        if (changes.length < scanPage) {
          scanned = Math.max(scanned, head); // every row up to head has been seen
          break;
        }
      }

      if (items.length > 0) {
        await link.session.send({
          t: "changes",
          epoch,
          items,
          upTo: scanned,
          more,
        });
      }
      link.sentUpTo = scanned;
      if (!more) return;
    }
  }
}
