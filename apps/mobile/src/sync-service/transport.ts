// What decides who connects to whom on this phone: the same rules as the Mac's
// LanTransport (apps/desktop/backend/sync/lan-transport.ts), with native code
// doing the listening, the dialing and Bonjour (see native.ts).
//   - a device Bonjour finds is dialed, and the Mac may dial us at the same
//     time: the engine keeps one connection of the pair and closes the other
//   - a dropped connection is tried again after a growing wait: two seconds,
//     four, up to a minute
//   - a connection from an address whose handshakes keep failing is refused,
//     which native code does on our word
//   - every few seconds: look again for devices that are not connected, and
//     notice that the network changed or the phone slept
//
// What the Mac does and this does not: dial the devices paired before at their
// last address, and the router. Both need a list of known devices, which the
// SyncStore does not give yet.
import type { SyncEngine, SyncError } from "@teneo/sync";

import type { DiscoveredDevice, NativeSync } from "./native";
import { NativeChannel } from "./native-channel";

const maintainEveryMs = 5000;
/** Native code gives up on a dial after five seconds. This is only for a
 *  native side that never answers, so a device is never "being dialed" for ever. */
const dialGuardMs = 10_000;
// a connection that ends in a protocol error this soon after opening failed its handshake
const handshakeWindowMs = 10_000;
// a connection that lasted this long was a real one
const healthyMs = 5000;

/** Time, injected so tests don't wait for it. */
export interface Timers {
  now(): number;
  every(ms: number, task: () => void): () => void;
  after(ms: number, task: () => void): () => void;
}

export const realTimers: Timers = {
  now: () => Date.now(),
  every(ms, task) {
    const handle = setInterval(task, ms);
    return () => clearInterval(handle);
  },
  after(ms, task) {
    const handle = setTimeout(task, ms);
    return () => clearTimeout(handle);
  },
};

interface DialResult {
  connected: boolean;
  error: SyncError | null;
  lastedMs: number;
}
const notConnected: DialResult = { connected: false, error: null, lastedMs: 0 };

/** A dial waiting for native code's answer */
interface PendingDial {
  opened(channel: NativeChannel): void;
  failed(): void;
}

export interface TransportOptions {
  engine: Pick<SyncEngine, "attach" | "discoveryTag" | "peers">;
  deviceId: string;
  native: Pick<
    NativeSync,
    | "close"
    | "connect"
    | "handshakeFailed"
    | "networkSignature"
    | "ready"
    | "restartDiscovery"
    | "send"
  >;
  timers?: Timers;
  /** Whether the user ended sync between this phone and that device, on
   *  either of the two: it is not dialed, wherever it is found. */
  isDisconnected?: (deviceId: string) => boolean;
  /** Something unexpected, never an ordinary refusal or disconnect. */
  onError?: (error: unknown) => void;
  /** A device refused this one outright (auth, version, protocol): trying
   *  again won't change that */
  onRefused?: (error: SyncError) => void;
}

export class PhoneTransport {
  private readonly options: TransportOptions;
  private readonly timers: Timers;
  private stopped = false;
  private stopMaintaining: (() => void) | null = null;
  private lastTick: number;
  private networkSignature = "";
  private readonly discovered = new Map<string, DiscoveredDevice>();
  // keys: a device id. Held while a connection is made and lasts.
  private readonly dialing = new Set<string>();
  private readonly retry = new Map<
    string,
    { failures: number; notBefore: number }
  >();
  private readonly connections = new Map<number, NativeChannel>();
  private readonly pendingDials = new Map<number, PendingDial>();

  constructor(options: TransportOptions) {
    this.options = options;
    this.timers = options.timers ?? realTimers;
    this.lastTick = this.timers.now();
  }

  /** Tell native code to listen, announce and browse, and keep up from then on. */
  async start(): Promise<void> {
    const { engine, deviceId, native } = this.options;
    const tag = await engine.discoveryTag();
    if (this.stopped) return;
    this.networkSignature = native.networkSignature();
    this.lastTick = this.timers.now();
    native.ready(tag, deviceId);
    this.stopMaintaining = this.timers.every(maintainEveryMs, () =>
      this.maintain(),
    );
  }

  /** End every connection, and stop dialing. */
  stop(): void {
    this.stopped = true;
    this.stopMaintaining?.();
    for (const [, pending] of this.pendingDials) pending.failed();
    this.pendingDials.clear();
    for (const channel of this.connections.values()) channel.close();
  }

  // --- what native code tells the page

  /** A connection is ready: one we dialed, or one that came in. */
  opened(id: number, address: string, initiator: boolean): void {
    const { native } = this.options;
    const dial = initiator ? this.pendingDials.get(id) : undefined;
    this.pendingDials.delete(id);
    if (this.stopped || (initiator && !dial)) {
      native.close(id, ""); // nobody is waiting for this one
      return;
    }

    const channel = new NativeChannel({
      initiator,
      // no port for one that came in: the port a device connects from means
      // nothing for dialing it
      remoteAddress: address,
      connection: {
        send: (message) => void native.send(id, message),
        close: (reason) => native.close(id, reason ?? ""),
      },
    });
    this.connections.set(id, channel);
    const startedAt = this.timers.now();

    if (dial) {
      dial.opened(channel);
      return;
    }
    void this.options.engine.attach(channel).then((error) => {
      if (error && failedHandshake(error, this.timers.now() - startedAt)) {
        native.handshakeFailed(address);
      }
    });
  }

  message(id: number, message: string): void {
    this.connections.get(id)?.deliver(message);
  }

  /** The connection is over, whichever side ended it. For a dial that never
   *  opened, it comes alone. */
  closed(id: number, reason: string): void {
    const channel = this.connections.get(id);
    if (channel) {
      this.connections.delete(id);
      channel.ended(reason);
      return;
    }
    this.pendingDials.get(id)?.failed();
    this.pendingDials.delete(id);
  }

  /** Bonjour found a device of this vault, or found it again at a new address. */
  found(device: DiscoveredDevice): void {
    if (this.stopped) return;
    this.discovered.set(device.deviceId, device);
    this.retry.delete(device.deviceId); // seen just now: worth trying at once
    void this.dial(device.deviceId);
  }

  // --- dialing

  private connectedTo(deviceId: string): boolean {
    return this.options.engine
      .peers()
      .some((peer) => peer.deviceId === deviceId);
  }

  private addressesOf(deviceId: string): string[] {
    const found = this.discovered.get(deviceId);
    return found
      ? found.addresses.map((address) => `${address}:${found.port}`)
      : [];
  }

  /** Connect to the first of the device's addresses that answers, and stay on
   *  it until it ends. Does nothing while one is already made or being made, or
   *  while the wait after a failure is not over. One connection per pair of
   *  devices: when both dial at once, the engine closes one of the two. */
  private async dial(deviceId: string): Promise<void> {
    if (this.stopped || deviceId === this.options.deviceId) return;
    if (this.dialing.has(deviceId) || this.connectedTo(deviceId)) return;
    if (this.options.isDisconnected?.(deviceId)) return;
    const retry = this.retry.get(deviceId);
    if (retry && this.timers.now() < retry.notBefore) return;

    this.dialing.add(deviceId);
    try {
      const targets = this.addressesOf(deviceId);
      let result = notConnected;
      for (const address of targets) {
        if (this.stopped) return;
        result = await this.connect(address);
        if (result.connected) break;
      }
      if (targets.length > 0) this.afterDial(deviceId, result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.dialing.delete(deviceId);
    }
  }

  /** Wait longer after each failure: a second, two, four, up to a minute. A
   *  connection that lasted is no failure, and is made again after a second. */
  private afterDial(deviceId: string, result: DialResult): void {
    const failedHard =
      result.error !== null &&
      ["auth", "version", "protocol"].includes(result.error.code);
    if (failedHard && result.error) this.options.onRefused?.(result.error);
    // Both devices dialed at once: the engine kept the other connection and
    // closed this one at once. That is no failure (engine.ts prefersNew)
    const duplicate =
      result.connected && !failedHard && this.connectedTo(deviceId);
    const healthy =
      duplicate ||
      (result.connected && result.lastedMs >= healthyMs && !failedHard);
    const failures = healthy
      ? 0
      : (this.retry.get(deviceId)?.failures ?? 0) + 1;
    const wait = healthy ? 1000 : Math.min(60_000, 1000 * 2 ** failures);
    this.retry.set(deviceId, {
      failures,
      notBefore: this.timers.now() + wait,
    });
  }

  /** Debug builds: dial `ip:port` once, as if Bonjour had found a device
   *  there. For emulators, which can't see each other's announcements. */
  debugDial(address: string): void {
    if (!this.stopped) void this.connect(address);
  }

  /** Dial `ip:port` and run the connection. Resolves when it ends; at once,
   *  not connected, when it could not be opened. */
  private connect(address: string): Promise<DialResult> {
    return new Promise((resolve) => {
      const id = this.options.native.connect(address);
      if (id < 0) {
        resolve(notConnected);
        return;
      }
      const cancelGuard = this.timers.after(dialGuardMs, () => {
        this.pendingDials.delete(id);
        this.options.native.close(id, "");
        resolve(notConnected);
      });
      this.pendingDials.set(id, {
        opened: (channel) => {
          cancelGuard();
          const openedAt = this.timers.now();
          void this.options.engine.attach(channel).then((error) =>
            resolve({
              connected: true,
              error,
              lastedMs: this.timers.now() - openedAt,
            }),
          );
        },
        failed: () => {
          cancelGuard();
          resolve(notConnected);
        },
      });
    });
  }

  // --- keeping up

  /** Every few seconds: look again for devices that are not connected, and
   *  notice that the network changed or the phone slept, after which the old
   *  announcements and waits mean nothing. */
  private maintain(): void {
    if (this.stopped) return;
    try {
      const now = this.timers.now();
      // a timer that fires much later than it should means the phone was asleep
      const slept = now - this.lastTick > maintainEveryMs * 3;
      this.lastTick = now;
      const signature = this.options.native.networkSignature();
      if (slept || signature !== this.networkSignature) {
        this.networkSignature = signature;
        this.retry.clear();
        this.options.native.restartDiscovery();
      }
      for (const deviceId of this.discovered.keys()) void this.dial(deviceId);
    } catch (error) {
      this.options.onError?.(error);
    }
  }
}

function failedHandshake(error: SyncError, lastedMs: number): boolean {
  return (
    ["auth", "protocol", "timeout"].includes(error.code) &&
    lastedMs < handshakeWindowMs
  );
}
