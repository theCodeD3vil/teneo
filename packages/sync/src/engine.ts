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
import {
  type VaultKeys,
  deriveVaultKeys,
  type Bytes,
  fromBase64,
  sha256,
  toBase64,
  toHex,
  utf8,
} from "./crypto";
import { enrollmentApprovalMs, type EnrollmentInvites } from "./enrollment";
import { type Hlc, isFutureStamp } from "./hlc";
import {
  batchLimits,
  blobChunkBytes,
  type BlobFrame,
  type BlobNoneFrame,
  type BlobWantFrame,
  capabilities,
  type ChangesFrame,
  handshakeMs,
  type Frame,
  iconLimits,
  type IconsFrame,
  type IconsWantFrame,
  removedWaitMs,
  type StateFrame,
} from "./protocol";
import {
  type ItemRecord,
  collapseSameText,
  hasSameContent,
  imageTypes,
  isSameItem,
  isSameRecord,
  isTombstone,
  maxImageBytes,
  maxTextBytes,
  mergeRecords,
  parseRecord,
  utf8Length,
} from "./record";
import {
  type FrameHandler,
  type EnrollmentInvite,
  type Scheduler,
  Session,
  SyncError,
} from "./session";
import type { StoredChange, SyncStore, SyncTransaction } from "./store";
import type {
  DevicePublicIdentity,
  VaultTrust,
  VaultTrustManager,
} from "./vault-trust";

/** A device that has the icons of the apps items were copied from: a Mac. */
export interface AppIconSource {
  /** The png of the app with this name, or null when this device has none. */
  icon(name: string): Promise<Bytes | null>;
}

/** A device that shows those icons but can't make them: a phone. It keeps
 *  one per app name and asks for the ones it lacks. */
export interface AppIconSink {
  /** Which of these apps this device has no icon for. */
  missing(names: string[]): Promise<string[]>;
  save(name: string, png: Bytes): Promise<void>;
}

/** Where a device keeps the bytes of its image items. An image record says
 *  only the picture's hash and size; the bytes are asked for by hash, and a
 *  device that holds them hands them to any device that asks. */
export interface ImageStore {
  /** The hashes of the images in the history, not deleted, whose bytes this
   *  device does not hold yet. */
  missing(): Promise<string[]>;
  /** How long the image with this hash is, or null when this device does
   *  not hold all of it. */
  size(hash: string): Promise<number | null>;
  /** A piece of it, or null when it can't be read (it was deleted since). */
  read(hash: string, offset: number, length: number): Promise<Bytes | null>;
  /** Keep a piece of an image that is arriving. Pieces come in order from
   *  offset 0, and one at offset 0 starts over. "done" once the last piece
   *  is in and the whole has the hash it was asked for by; "refused" for a
   *  piece out of order, an image nobody needs, or a whole that is not what
   *  its hash says, which is then dropped. */
  write(
    hash: string,
    offset: number,
    total: number,
    piece: Bytes,
  ): Promise<"more" | "done" | "refused">;
}

const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An icon from another device is untrusted: a png, and a small one. */
export function isIconPng(bytes: Bytes): boolean {
  return (
    bytes.length > pngSignature.length &&
    bytes.length <= iconLimits.bytes &&
    pngSignature.every((byte, index) => bytes[index] === byte)
  );
}

/** The devices the user disconnected on this device. The app keeps them, so
 *  one stays disconnected across restarts. */
export interface Removals {
  /** The pairing the device had when it was disconnected here ("" when it
   *  had said none), or null when it is not disconnected. */
  removed(deviceId: string): Promise<string | null>;
  /** The device was paired again: it is no longer disconnected. */
  restore(deviceId: string): Promise<void>;
}

interface CommonEngineOptions {
  /** 32 hex digits, made once per device. */
  deviceId: string;
  /** Shown to the other devices: the computer's name. */
  name: string;
  platform: string;
  /** Who made this device ("google"), for the others to show its logo. */
  maker?: string;
  /** The id of this device's pairing: made anew whenever it is paired, so a
   *  device that disconnected it can tell it was paired again. */
  pairing?: string;
  /** The devices disconnected here: none of them is synced with. */
  removals?: Removals;
  /** Another device said it disconnected this one. */
  onRemovedBy?: (peer: ConnectedPeer) => void;
  /** This device hands out app icons to the devices that ask. */
  iconSource?: AppIconSource;
  /** This device asks for the icons of the apps in the items it receives. */
  iconSink?: AppIconSink;
  /** This device syncs images: it keeps their bytes here. Without it, image
   *  items are neither sent nor taken. */
  images?: ImageStore;
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
  /** An icon arrived for an app this device had none for. */
  onIconsChanged?: () => void;
  /** A connection failed because of something on this device. */
  onError?: (error: unknown) => void;
}

interface LegacyEngineOptions {
  trust?: never;
  invites?: never;
  approveEnrollment?: never;
  vaultKey: Bytes;
  /** The Mac, while it shows a pairing code: that code's one-time key, which
   *  a phone joining may prove instead of the vault's (pairing.ts), or null. */
  pairingKey?: () => Bytes | null;
  /** The Mac: a phone proved the pairing key and was given the vault's. */
  onPaired?: () => void;
  /** A phone that joined with a pairing key (its vaultKey here): the vault
   *  key the Mac gave it. Without this, a vault frame ends the connection. */
  onVaultKey?: (vaultKey: Bytes) => void;
}

export interface TrustedEngineOptions {
  trust: VaultTrustManager;
  invites?: EnrollmentInvites;
  /** Confirm on the primary before admitting the identity that proved the QR. */
  approveEnrollment?: (device: DevicePublicIdentity) => Promise<boolean>;
  vaultKey?: never;
  pairingKey?: never;
  onPaired?: never;
  onVaultKey?: never;
  /** The retained peer persisted this generation. Treat a missing ack as
   *  pending until it acknowledges or reconnects on the current generation. */
  onTrustConfirmed?: (deviceId: string, generation: number) => void;
}

export type EngineOptions = CommonEngineOptions &
  (LegacyEngineOptions | TrustedEngineOptions);

export interface ConnectedPeer {
  deviceId: string;
  name: string;
  platform: string;
  /** Empty when the device didn't say. */
  maker: string;
  /** Empty when the device said none. */
  pairing: string;
  address: string | undefined;
}

// How many rows one read of the store asks for
const scanPage = batchLimits.items;
/** Image requests from one peer that may wait to be served. It asks for one
 *  at a time, so a few is already more than it should. */
const maxQueuedBlobWants = 16;

interface Link {
  session: Session;
  peerId: string;
  name: string;
  platform: string;
  maker: string;
  pairing: string;
  /** The peer is disconnected here: nothing more is read from it or sent. */
  refused: boolean;
  /** What the peer said it understands. */
  caps: string[];
  /** App names this device has asked the peer's icon for, on this connection:
   *  it answers with what it has, so none is asked for twice. */
  askedIcons: Set<string>;
  /** Image hashes asked of the peer on this connection, answered or not. */
  askedBlobs: Set<string>;
  /** Hashes still to ask the peer for, one at a time. */
  blobQueue: string[];
  /** The image arriving from the peer now. */
  fetching: string | null;
  /** The images the peer asked for are sent one after another. */
  serving: Promise<void>;
  /** How many of those are not sent yet. */
  servingCount: number;
  /** The peer's store epoch: null until its state frame arrives. */
  epoch: string | null;
  /** The peer has everything up to here. Null until its state frame arrives. */
  sentUpTo: number | null;
  pumping: boolean;
  dirty: boolean;
}

export class SyncEngine {
  private readonly options: EngineOptions;
  private readonly keys: Promise<VaultKeys> | null;
  private readonly links = new Map<string, Link>();
  private readonly controlSessions = new Set<Session>();
  private readonly enrolling = new Set<Session>();
  private readonly stopWatchingTrust: (() => void) | undefined;
  private ownEpoch: Promise<string> | null = null;
  private clockSeeded: Promise<void> | null = null;
  private attaching = 0;
  private stopped = false;

  constructor(options: EngineOptions) {
    this.options = options;
    this.keys = options.trust ? null : deriveVaultKeys(options.vaultKey);
    this.stopWatchingTrust = options.trust?.beforeInstall(() => {
      // Keep receiving control sessions alive long enough to acknowledge
      // their durable update. Senders must not deliver a superseded snapshot.
      for (const session of this.controlSessions)
        if (session.trustUpdateDirection === "send") session.close();
      for (const session of this.enrolling) session.close();
      for (const link of this.links.values()) {
        link.refused = true;
        link.session.close();
      }
    });
  }

  /** What devices of this vault announce and look for, so others are ignored. */
  async discoveryTag(): Promise<string> {
    if (this.options.trust)
      return toHex(
        await sha256(
          utf8(`teneo discovery 3|${this.options.trust.current.pin.vaultId}`),
        ),
      );
    return (await this.keys!).tag;
  }

  /** Run a connection from a transport, whichever side opened it. Settles when
   *  it ends: with the error that ended it, or null when this side closed it. */
  async attach(channel: Channel): Promise<SyncError | null> {
    this.attaching += 1;
    let session: Session | null = null;
    let link: Link | null = null;
    try {
      if (this.stopped) throw new SyncError("closed", "Sync is off");
      await this.seedClock();
      const common = {
        deviceId: this.options.deviceId,
        scheduler: this.options.scheduler,
        now: this.options.now,
      };
      if (this.options.trust) {
        const manager = this.options.trust;
        const trust = manager.current;
        if (!manager.permits(trust))
          throw new SyncError("closed", "The trusted device list is updating");
        const invite = this.options.invites?.current() ?? undefined;
        session = await Session.open(channel, {
          ...common,
          identity: manager.identity,
          trust,
          invite,
        });
        if (this.stopped || !manager.permits(trust))
          throw new SyncError("closed", "The trusted device list changed");
        if (session.enrollmentPeer && invite)
          return this.enrollDevice(session, manager, trust, invite);
        if (session.trustUpdateDirection)
          return this.reconcileTrust(session, manager, trust);
        this.options.onTrustConfirmed?.(session.peerId, trust.generation);
      } else {
        const pairingKey = this.options.pairingKey?.() ?? null;
        session = await Session.open(channel, {
          ...common,
          authKey: (await this.keys!).authKey,
          pairingAuthKey: pairingKey
            ? (await deriveVaultKeys(pairingKey)).authKey
            : undefined,
        });
        if (this.stopped) throw new SyncError("closed", "Sync is off");
        if (session.usedPairingKey)
          return await this.pair(session, this.options.vaultKey);
      }
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

  /** A phone proved the pairing code's one-time key: it gets the vault key,
   *  and nothing else, on this connection. The code is spent. */
  private async pair(session: Session, key: Bytes): Promise<SyncError | null> {
    await session.send({ t: "vault", key: toBase64(key) });
    this.options.onPaired?.();
    // the phone closes once it has read the key: closing first could drop it
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      session.closed,
      new Promise((resolve) => (timer = setTimeout(resolve, handshakeMs))),
    ]);
    clearTimeout(timer);
    session.close();
    return null;
  }

  private async reconcileTrust(
    session: Session,
    manager: VaultTrustManager,
    trust: VaultTrust,
  ): Promise<SyncError | null> {
    this.controlSessions.add(session);
    const timer = setTimeout(() => session.close(), handshakeMs);
    let complete = false;
    try {
      if (session.trustUpdateDirection === "send") {
        session.onFrame((frame) => {
          if (
            frame.t !== "trust-ack" ||
            frame.fingerprint !== trust.fingerprint
          )
            throw new SyncError(
              "auth",
              "The vault update was not acknowledged",
            );
          if (manager.permits(trust) && this.options.trust)
            this.options.onTrustConfirmed?.(session.peerId, trust.generation);
          complete = true;
          session.close();
        });
        await session.send({ t: "trust-update", update: trust.snapshot() });
      } else {
        session.onFrame(async (frame) => {
          if (complete || frame.t !== "trust-update")
            throw new SyncError("protocol", "Unexpected vault update");
          const next = await manager.accept(frame.update, (next) =>
            session.matchesTrustUpdate(next),
          );
          await session.send({ t: "trust-ack", fingerprint: next.fingerprint });
          complete = true;
          // Let the primary receive the ack and close, or time out.
        });
      }
      const ended = await session.closed;
      return complete && ended?.code === "closed" ? null : ended;
    } catch (error) {
      return error instanceof SyncError
        ? error
        : new SyncError("failed", "The vault update did not finish");
    } finally {
      clearTimeout(timer);
      this.controlSessions.delete(session);
      session.close();
    }
  }

  private async enrollDevice(
    session: Session,
    manager: VaultTrustManager,
    previous: VaultTrust,
    invite: EnrollmentInvite,
  ): Promise<SyncError | null> {
    const peer = session.enrollmentPeer!;
    this.enrolling.add(session);
    const timer = setTimeout(() => session.close(), enrollmentApprovalMs);
    try {
      if (
        !this.options.invites?.claim(invite) ||
        !(await Promise.race([
          this.options.approveEnrollment?.(peer),
          session.closed.then(() => false),
        ])) ||
        this.stopped ||
        !manager.permits(previous)
      )
        throw new SyncError("auth", "The enrollment was not approved");
      this.enrolling.delete(session);
      const next = await manager.enroll(peer, previous);
      if (this.stopped || !manager.permits(next))
        throw new SyncError("closed", "The trusted device list changed");
      return await this.reconcileTrust(session, manager, next);
    } catch {
      session.close();
      return new SyncError("auth", "The enrollment did not finish");
    } finally {
      clearTimeout(timer);
      this.enrolling.delete(session);
    }
  }

  /** Tell the engine this device wrote to its history, or changed what may sync. */
  localChanged(): void {
    for (const link of this.links.values()) this.pump(link);
  }

  peers(): ConnectedPeer[] {
    return [...this.links.values()]
      .filter((link) => link.epoch !== null && !link.refused)
      .map((link) => this.peerOf(link));
  }

  private peerOf(link: Link): ConnectedPeer {
    return {
      deviceId: link.peerId,
      name: link.name,
      platform: link.platform,
      maker: link.maker,
      pairing: link.pairing,
      address: link.session.remoteAddress,
    };
  }

  /** The user disconnected this device, and the app has it in `removals`:
   *  tell it, and end the connection to it if there is one. */
  async remove(deviceId: string): Promise<void> {
    const link = this.links.get(deviceId);
    if (link) await this.refuse(link);
  }

  /** End the connection to a device disconnected here. One that reads the
   *  removed frame closes on reading it: closing first could drop it. */
  private async refuse(link: Link): Promise<void> {
    if (link.refused) return;
    link.refused = true;
    this.options.onPeersChanged?.();
    if (link.caps.includes(capabilities.removal)) {
      try {
        await this.sendOrClosed(link, { t: "removed" });
        let timer: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          link.session.closed,
          new Promise(
            (resolve) => (timer = setTimeout(resolve, removedWaitMs)),
          ),
        ]);
        clearTimeout(timer);
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    link.session.close();
  }

  /** Whether the device is disconnected here. One that was, and has been
   *  paired again since, no longer is. */
  private async isRemoved(deviceId: string, pairing: string): Promise<boolean> {
    const { removals } = this.options;
    const removedWith = (await removals?.removed(deviceId)) ?? null;
    if (!removals || removedWith === null) return false;
    if (pairing === "" || pairing === removedWith) return true;
    await removals.restore(deviceId);
    return false;
  }

  stop(): void {
    this.stopped = true;
    this.stopWatchingTrust?.();
    for (const session of this.controlSessions) session.close();
    for (const session of this.enrolling) session.close();
    for (const link of this.links.values()) link.session.close();
  }

  /** Nothing is connecting, being read or being sent. For tests. */
  isIdle(): boolean {
    return (
      this.attaching === 0 &&
      [...this.links.values()].every(
        (link) =>
          !link.pumping && link.servingCount === 0 && link.session.idle(),
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
      maker: "",
      pairing: "",
      refused: false,
      caps: [],
      askedIcons: new Set(),
      askedBlobs: new Set(),
      blobQueue: [],
      fetching: null,
      serving: Promise.resolve(),
      servingCount: 0,
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
      ...(this.options.maker ? { maker: this.options.maker } : {}),
      caps: this.ownCaps(),
      ...(this.options.pairing ? { pairing: this.options.pairing } : {}),
      cursor: { epoch: known?.epoch ?? null, seq: known?.receivedSeq ?? 0 },
    });
    return link;
  }

  // --- receiving

  private async handleFrame(
    link: Link,
    frame: Parameters<FrameHandler>[0],
  ): Promise<void> {
    // a device disconnected here, on its way out: whatever it still sends
    if (link.refused) return;
    if (frame.t === "trust-update" || frame.t === "trust-ack")
      throw new SyncError("protocol", "Unexpected vault update");
    if (frame.t === "vault") return this.handleVault(link, frame.key);
    if (frame.t === "removed") return this.handleRemoved(link);
    if (frame.t === "state") await this.handleState(link, frame);
    else if (frame.t === "changes") await this.handleChanges(link, frame);
    else if (frame.t === "icons-want") await this.handleIconsWant(link, frame);
    else if (frame.t === "icons") await this.handleIcons(link, frame);
    else if (frame.t === "blob-want") this.handleBlobWant(link, frame);
    else if (frame.t === "blob") await this.handleBlob(link, frame);
    else await this.handleBlobNone(link, frame);
  }

  private async handleState(link: Link, frame: StateFrame): Promise<void> {
    if (link.epoch !== null) {
      throw new SyncError("protocol", "The other device sent its state twice");
    }
    link.name = frame.name;
    link.platform = frame.platform;
    link.maker = frame.maker ?? "";
    link.pairing = frame.pairing ?? "";
    link.caps = frame.caps ?? [];
    if (await this.isRemoved(link.peerId, link.pairing)) {
      // not awaited: it waits for the device to close, which this would block
      void this.refuse(link);
      return;
    }
    link.epoch = frame.epoch;
    // a cursor into another store, or into one this device has since replaced,
    // means nothing: start from the beginning
    link.sentUpTo =
      frame.cursor.epoch === (await this.epoch()) ? frame.cursor.seq : 0;

    const address = link.session.remoteAddress;
    await this.options.store.transaction((tx) =>
      tx.updatePeer(link.peerId, {
        name: frame.name,
        platform: frame.platform,
        maker: frame.maker ?? "",
        pairing: link.pairing,
        lastSeenAt: this.now(),
        ...(address ? { lastAddress: address } : {}),
      }),
    );
    this.options.onPeersChanged?.();
    this.pump(link);
    // images whose bytes never arrived, from this device or another
    await this.askForImages(link).catch((error: unknown) =>
      this.options.onError?.(error),
    );
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
      // A pin stamped days ahead is from a broken clock or a peer that
      // means harm: it would win every merge of that item for good
      if (record?.pinned && isFutureStamp(record.pinned.stamp, this.now())) {
        continue;
      }
      // an image is only taken by a device that can keep its bytes
      if (record && (record.kind === "text" || this.options.images)) {
        records.push(record);
      }
    }

    const { store } = this.options;
    // the batch and the cursor are saved together: after a crash the next
    // connection resumes at the last batch that was fully applied
    const changed = await store.transaction(async (tx) => {
      let changed = false;
      await tx.prefetch?.(records.map((record) => record.id));
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
    // the batch is saved whatever becomes of its icons and its images' bytes
    await this.askForIcons(link, records).catch((error: unknown) =>
      this.options.onError?.(error),
    );
    if (records.some((record) => record.image !== null)) {
      await this.askForImages(link).catch((error: unknown) =>
        this.options.onError?.(error),
      );
    }
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
    if (newest && hasSameContent(newest, incoming)) {
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

  // --- app icons: a phone asks a Mac for the icons of the apps its items
  // were copied from, once per app, and keeps them

  /** Ask the peer for the icons of the apps in these records that this
   *  device has none for. */
  private async askForIcons(link: Link, records: ItemRecord[]): Promise<void> {
    const { iconSink } = this.options;
    if (!iconSink || !link.caps.includes(capabilities.appIcons)) return;
    const names = new Set<string>();
    for (const record of records) {
      const name = record.sourceApp;
      if (name && !isTombstone(record) && !link.askedIcons.has(name)) {
        names.add(name);
      }
    }
    if (names.size === 0) return;
    const missing = await iconSink.missing([...names]);
    for (let start = 0; start < missing.length; start += iconLimits.count) {
      const batch = missing.slice(start, start + iconLimits.count);
      for (const name of batch) link.askedIcons.add(name);
      await this.sendOrClosed(link, { t: "icons-want", names: batch });
    }
  }

  private async handleIconsWant(
    link: Link,
    frame: IconsWantFrame,
  ): Promise<void> {
    const { iconSource } = this.options;
    // a device that never offered icons has none to give: not worth an error
    if (!iconSource) return;
    const icons: IconsFrame["icons"] = [];
    for (const name of new Set(frame.names)) {
      const png = await iconSource.icon(name).catch(() => null);
      if (png && isIconPng(png)) icons.push({ name, png: toBase64(png) });
    }
    if (icons.length > 0) await this.sendOrClosed(link, { t: "icons", icons });
  }

  private async handleIcons(link: Link, frame: IconsFrame): Promise<void> {
    const { iconSink } = this.options;
    if (!iconSink) return;
    let saved = false;
    for (const { name, png } of frame.icons) {
      // only what was asked for, and only a real, small png
      if (!link.askedIcons.has(name)) continue;
      const bytes = fromBase64(png);
      if (!bytes || !isIconPng(bytes)) continue;
      try {
        await iconSink.save(name, bytes);
        saved = true;
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    if (saved) this.options.onIconsChanged?.();
  }

  // --- images: a record names its picture by hash, and the bytes are asked
  // for apart from it, a piece at a time, so no message is ever large

  private ownCaps(): string[] {
    return [
      capabilities.removal,
      ...(this.options.iconSource ? [capabilities.appIcons] : []),
      ...(this.options.images ? [capabilities.images] : []),
    ];
  }

  private sharesImages(link: Link): boolean {
    return (
      this.options.images !== undefined &&
      link.caps.includes(capabilities.images)
    );
  }

  /** Ask the peer for the bytes of every image this device lacks, one image
   *  at a time. */
  private async askForImages(link: Link): Promise<void> {
    const { images } = this.options;
    if (!images || !this.sharesImages(link)) return;
    for (const hash of await images.missing()) {
      if (link.askedBlobs.has(hash)) continue;
      link.askedBlobs.add(hash);
      link.blobQueue.push(hash);
    }
    await this.fetchNextImage(link);
  }

  private async fetchNextImage(link: Link): Promise<void> {
    if (link.fetching !== null) return;
    const hash = link.blobQueue.shift();
    if (hash === undefined) return;
    link.fetching = hash;
    await this.sendOrClosed(link, { t: "blob-want", hash });
  }

  /** The peer disconnected this device: it takes no more connections from
   *  it, so the app stops making them. */
  private handleRemoved(link: Link): void {
    this.options.onRemovedBy?.(this.peerOf(link));
    link.session.close();
  }

  /** The vault key, from the Mac whose pairing code this phone scanned. Any
   *  other device sending one is not to be believed. */
  private handleVault(link: Link, key: string): void {
    const vaultKey = fromBase64(key);
    if (!this.options.onVaultKey || vaultKey?.length !== 32) {
      throw new SyncError("protocol", "The other device sent a key unasked");
    }
    this.options.onVaultKey(vaultKey);
    link.session.close();
  }

  /** The peer asked for an image: send it in pieces, after the ones it asked
   *  for before. Not awaited by the caller, so the peer's other frames (a
   *  ping among them) are read meanwhile. A peer asks for one at a time
   *  (blobQueue), so a pile of requests is one flooding this device, and the
   *  connection ends. */
  private handleBlobWant(link: Link, frame: BlobWantFrame): void {
    if (link.servingCount >= maxQueuedBlobWants) {
      throw new SyncError(
        "protocol",
        "The other device asked for too many images at once",
      );
    }
    link.servingCount += 1;
    link.serving = link.serving
      .then(() => this.sendImage(link, frame.hash))
      .catch((error: unknown) => this.options.onError?.(error))
      .finally(() => {
        link.servingCount -= 1;
      });
  }

  /** Whether the link is still this engine's connection to its peer */
  private isLive(link: Link): boolean {
    return !this.stopped && this.links.get(link.peerId) === link;
  }

  private async sendImage(link: Link, hash: string): Promise<void> {
    // one asked for on a connection since closed is read from disk for no one
    if (!this.isLive(link)) return;
    const { images } = this.options;
    const total = (await images?.size(hash).catch(() => null)) ?? null;
    if (!images || total === null || total < 1 || total > maxImageBytes) {
      await this.sendOrClosed(link, { t: "blob-none", hash });
      return;
    }
    for (let offset = 0; offset < total; offset += blobChunkBytes) {
      if (!this.isLive(link)) return;
      const length = Math.min(blobChunkBytes, total - offset);
      const piece = await images.read(hash, offset, length).catch(() => null);
      if (!piece || piece.length !== length) {
        // gone since it was asked for: the peer stops waiting for the rest
        await this.sendOrClosed(link, { t: "blob-none", hash });
        return;
      }
      await this.sendOrClosed(link, {
        t: "blob",
        hash,
        offset,
        total,
        data: toBase64(piece),
      });
    }
  }

  private async handleBlob(link: Link, frame: BlobFrame): Promise<void> {
    const { images } = this.options;
    // only the image that was asked for, and is still awaited
    if (!images || link.fetching !== frame.hash) return;
    const piece = fromBase64(frame.data);
    const result = piece
      ? await images
          .write(frame.hash, frame.offset, frame.total, piece)
          .catch((error: unknown) => {
            this.options.onError?.(error);
            return "refused" as const;
          })
      : "refused";
    if (result === "more") return;
    link.fetching = null;
    if (result === "done") this.options.onItemsChanged?.();
    await this.fetchNextImage(link);
  }

  private async handleBlobNone(
    link: Link,
    frame: BlobNoneFrame,
  ): Promise<void> {
    if (link.fetching !== frame.hash) return;
    // another device may hold it: it is asked again on the next connection
    link.fetching = null;
    await this.fetchNextImage(link);
  }

  /** A connection that closed mid-send is an ordinary disconnect */
  private async sendOrClosed(link: Link, frame: Frame): Promise<void> {
    try {
      await link.session.send(frame);
    } catch (error) {
      if (!(error instanceof SyncError && error.code === "closed")) throw error;
    }
  }

  // --- sending

  private pump(link: Link): void {
    link.dirty = true;
    if (link.pumping || link.sentUpTo === null || link.refused) return;
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

  private isEligible(
    change: StoredChange,
    allowSecrets: boolean,
    link: Link,
  ): boolean {
    const { record } = change;
    if (record.kind === "image") {
      // an older Teneo, or a device that keeps no images, never gets one
      if (!this.sharesImages(link)) return false;
      if (isTombstone(record)) return true;
      const image = record.image;
      return (
        image !== null &&
        image.bytes <= maxImageBytes &&
        imageTypes.includes(image.type)
      );
    }
    if (isTombstone(record)) return true;
    if (change.hasSecret && !allowSecrets) return false;
    return utf8Length(record.text!) <= maxTextBytes;
  }

  /** Send everything the peer has not read, a batch at a time. */
  private async sendChanges(link: Link): Promise<void> {
    const { store } = this.options;
    const epoch = await this.epoch();
    const allowSecrets = this.options.syncSecrets?.() ?? false;

    while (link.sentUpTo !== null && !link.refused) {
      const items: ItemRecord[] = [];
      let bytes = 0;
      let scanned = link.sentUpTo;
      let more = false;

      scan: while (true) {
        const { changes, head } = await store.changesAfter(scanned, scanPage);
        for (const change of changes) {
          if (this.isEligible(change, allowSecrets, link)) {
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
