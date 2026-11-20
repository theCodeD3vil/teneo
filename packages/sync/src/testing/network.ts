// A few simulated devices joined by in-memory channels. They share one vault
// key and one clock that moves forward on every reading, so a run is the same
// every time.
import { type MemoryPair, memoryChannelPair } from "../channel";
import { type Bytes, randomBytes } from "../crypto";
import { type AppIconSink, type AppIconSource, SyncEngine } from "../engine";
import { Hlc } from "../hlc";
import type { SyncError } from "../session";
import {
  type CopyOptions,
  type ImageOptions,
  MemoryStore,
} from "./memory-store";

export interface DeviceOptions {
  name?: string;
  maker?: string;
  iconSource?: AppIconSource;
  iconSink?: AppIconSink;
  /** False for a device that keeps no images, as an older Teneo */
  images?: boolean;
  historyLimit?: number;
  /** What the ids of items made here start with. */
  idPrefix?: string;
}

export class TestDevice {
  readonly id: string;
  readonly store: MemoryStore;
  readonly engine: SyncEngine;
  /** How many times received changes changed this device's history. */
  itemsChanged = 0;
  /** How many times an icon arrived that this device had none for. */
  iconsChanged = 0;
  private syncSecrets = false;

  constructor(network: TestNetwork, id: string, options: DeviceOptions = {}) {
    this.id = id;
    const clock = new Hlc(id, network.now);
    this.store = new MemoryStore(id, clock, network.now, options.idPrefix);
    this.store.historyLimit = options.historyLimit ?? null;
    this.engine = new SyncEngine({
      deviceId: id,
      name: options.name ?? `Device ${id.slice(0, 1)}`,
      platform: "test",
      maker: options.maker,
      iconSource: options.iconSource,
      iconSink: options.iconSink,
      images: options.images === false ? undefined : this.store.images,
      onIconsChanged: () => {
        this.iconsChanged += 1;
      },
      vaultKey: network.vaultKey,
      store: this.store,
      syncSecrets: () => this.syncSecrets,
      clock,
      now: network.now,
      // heartbeats only when a test advances them
      scheduler: network.scheduler,
      onItemsChanged: () => {
        this.itemsChanged += 1;
      },
      onError: (error) => network.errors.push(error),
    });
  }

  async copyImage(bytes: Bytes, options?: ImageOptions): Promise<string> {
    const id = await this.store.copyImage(bytes, options);
    this.engine.localChanged();
    return id;
  }

  copy(text: string, options?: CopyOptions): string {
    const id = this.store.copy(text, options);
    this.engine.localChanged();
    return id;
  }

  pin(id: string, pinned: boolean): void {
    this.store.pin(id, pinned);
    this.engine.localChanged();
  }

  remove(id: string): void {
    this.store.remove(id);
    this.engine.localChanged();
  }

  allowSecrets(allowed: boolean): void {
    this.syncSecrets = allowed;
    if (allowed) this.store.restampSecrets();
    this.engine.localChanged();
  }
}

/** Heartbeat timers that only run when a test calls tick(). */
export class ManualScheduler {
  private tasks = new Set<() => void>();

  every(_milliseconds: number, task: () => void): () => void {
    this.tasks.add(task);
    return () => this.tasks.delete(task);
  }

  tick(): void {
    for (const task of this.tasks) task();
  }
}

export class TestNetwork {
  readonly vaultKey = randomBytes(32);
  readonly scheduler = new ManualScheduler();
  readonly devices = new Map<string, TestDevice>();
  /** Failures that were not an ordinary disconnect. */
  readonly errors: unknown[] = [];
  private tick: number;
  private wipes = 0;
  /** Every connection made, to see when nothing is in flight. */
  private readonly pairs = new Set<MemoryPair>();
  private readonly links = new Map<string, MemoryPair>();

  /** A new time on every reading. */
  readonly now = (): number => ++this.tick;

  /** `start`: the time the network's clock starts at. A test that mixes in a
   *  device on the real clock starts it there too: a peer's pin stamped days
   *  ahead of a device's clock is refused (isFutureStamp). */
  constructor(start = 1_000_000_000_000) {
    this.tick = start;
  }

  /** A device named by a letter: its id is that letter 32 times. */
  add(letter: string, options?: DeviceOptions): TestDevice {
    const device = new TestDevice(this, letter.repeat(32), options);
    this.devices.set(letter, device);
    return device;
  }

  /** The device is replaced by an empty one with the same id and a new store
   *  epoch, as if its database were deleted. */
  wipe(letter: string, options?: DeviceOptions): TestDevice {
    const old = this.devices.get(letter)!;
    for (const [key, pair] of this.links) {
      if (key.includes(old.id)) {
        pair.initiator.close("wiped");
        this.links.delete(key);
      }
    }
    old.engine.stop();
    this.wipes += 1;
    // a new database makes new ids: they are random in the real app
    return this.add(letter, {
      idPrefix: `${letter}wipe${this.wipes}`,
      ...options,
    });
  }

  private key(a: TestDevice, b: TestDevice): string {
    return [a.id, b.id].sort().join("|");
  }

  isConnected(a: TestDevice, b: TestDevice): boolean {
    return this.links.has(this.key(a, b));
  }

  /** `from` opens the connection, as the Mac does to a phone on a hotspot. */
  connect(from: TestDevice, to: TestDevice): MemoryPair {
    const pair = memoryChannelPair();
    this.pairs.add(pair);
    this.links.set(this.key(from, to), pair);
    for (const [device, channel] of [
      [from, pair.initiator],
      [to, pair.responder],
    ] as const) {
      void device.engine.attach(channel).then((error: SyncError | null) => {
        if (error && error.code !== "closed") this.errors.push(error);
      });
    }
    return pair;
  }

  disconnect(a: TestDevice, b: TestDevice): void {
    const key = this.key(a, b);
    this.links.get(key)?.initiator.close("test");
    this.links.delete(key);
  }

  /** Wait until no message is in flight and no engine is working. */
  async settle(): Promise<void> {
    let quietRounds = 0;
    for (let round = 0; round < 3000 && quietRounds < 4; round++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const busy =
        [...this.pairs].some((pair) => pair.pending() > 0) ||
        [...this.devices.values()].some((device) => !device.engine.isIdle());
      quietRounds = busy ? 0 : quietRounds + 1;
    }
    if (quietRounds < 4) throw new Error("The network never went quiet");
  }

  stop(): void {
    for (const device of this.devices.values()) device.engine.stop();
  }
}
