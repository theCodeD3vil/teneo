// Carries the sync engine's connections over WebSockets on the local network.
// Either device may open one, so this both listens and dials:
//   - it listens on the first free of five ports, and refuses anything that is
//     not from the local network
//   - it dials the devices discovery finds, the last address of each device
//     paired before, and the router (on a phone's hotspot, that is the phone)
//   - a dropped connection is tried again, with a growing wait
// What goes over a connection is the engine's business: this only makes them.
import {
  byeMessage,
  type PeerRecord,
  type SyncEngine,
  type SyncError,
} from "@teneo/sync";

import { isFromWebPage } from "./browser-request";
import type { DiscoveredDevice, Discovery } from "./discovery";
import {
  isAtHost,
  isLocalNetworkAddress,
  isLoopbackAddress,
} from "./local-address";
import { syncPorts } from "./ports";
import { SocketChannel } from "./ws-channel";

const maintainEveryMs = 5000;
const connectTimeoutMs = 5000;
const maxInbound = 32;
// an address whose handshakes fail too often is refused for a while
const failureLimit = { count: 5, windowMs: 60_000 };
// a connection that ends in a protocol error this soon after opening failed its handshake
const handshakeWindowMs = 10_000;
// a connection that lasted this long was a real one
const healthyMs = 5000;

type Server = ReturnType<typeof tjs.serve>;

interface SocketData {
  address: string;
  channel: SocketChannel | null;
}

interface ConnectResult {
  connected: boolean;
  error: SyncError | null;
  lastedMs: number;
}
const notConnected: ConnectResult = {
  connected: false,
  error: null,
  lastedMs: 0,
};

export interface LanTransportOptions {
  engine: SyncEngine;
  deviceId: string;
  discovery: Discovery;
  /** The devices paired before, whose last address is tried. */
  knownPeers: () => Promise<PeerRecord[]>;
  ports?: number[];
  /** Which addresses may connect to us and be dialed: local networks only,
   *  unless a test needs another rule. */
  isLocalAddress?: (address: string) => boolean;
  /** Take connections from this Mac itself (127.0.0.1, ::1): for tests and
   *  dev runs only, as any app or web page here can connect from there. */
  allowLoopback?: boolean;
  /** Something unexpected, never an ordinary refusal or disconnect. */
  onError?: (error: unknown) => void;
}

export class LanTransport {
  private readonly options: LanTransportOptions;
  private readonly isLocal: (address: string) => boolean;
  private server: Server | null = null;
  private listeningOn: number | null = null;
  private stopped = false;
  private maintaining = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTick = Date.now();
  private networkSignature = "";
  private readonly discovered = new Map<string, DiscoveredDevice>();
  // keys: a device id, or "gateway". Held while a connection is made and lasts.
  private readonly dialing = new Set<string>();
  private readonly retry = new Map<
    string,
    { failures: number; notBefore: number }
  >();
  private readonly failedHandshakes = new Map<string, number[]>();
  private readonly inbound = new Set<SocketChannel>();
  private readonly outbound = new Set<WebSocket>();

  constructor(options: LanTransportOptions) {
    this.options = options;
    const isLocal = options.isLocalAddress ?? isLocalNetworkAddress;
    this.isLocal = options.allowLoopback
      ? isLocal
      : (address) => isLocal(address) && !isLoopbackAddress(address);
  }

  /** The port this device listens on, or null when none of the five was free. */
  get port(): number | null {
    return this.listeningOn;
  }

  async start(): Promise<void> {
    this.listeningOn = await this.listen();
    const { engine, deviceId, discovery } = this.options;
    const tag = await engine.discoveryTag();
    if (this.stopped) return;
    this.networkSignature = networkSignature();
    discovery.start({
      tag,
      deviceId,
      port: this.listeningOn,
      onDevice: (device) => this.found(device),
      onError: (error) => this.options.onError?.(error),
    });
    this.timer = setInterval(() => void this.maintain(), maintainEveryMs);
    void this.maintain();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    clearInterval(this.timer);
    this.options.discovery.stop();
    for (const socket of this.outbound) closeQuietly(socket);
    for (const channel of this.inbound) channel.close();
    await this.server?.close();
    this.server = null;
  }

  // --- listening

  private async listen(): Promise<number | null> {
    for (const port of this.options.ports ?? syncPorts) {
      // tjs.serve does not fail on a port in use, so look first
      if (!(await portIsFree(port))) continue;
      try {
        this.server = tjs.serve({
          port,
          listenIp: "0.0.0.0",
          fetch: (request, context) =>
            this.accept(request, context.server, context.remoteAddress),
          websocket: {
            open: (ws) => this.opened(ws.data as SocketData, ws),
            message: (ws, data) =>
              void (ws.data as SocketData).channel?.deliver(data),
            close: (ws, _code, reason) =>
              void (ws.data as SocketData).channel?.ended(reason),
            error: (ws) => void (ws.data as SocketData).channel?.ended(),
          },
        });
        return this.server.port;
      } catch (error) {
        this.options.onError?.(error);
      }
    }
    return null;
  }

  private accept(
    request: Request,
    server: Server,
    address: string,
  ): Response | undefined {
    // a web page, before anything else: it must not use up a device's tries
    if (!this.isLocal(address) || isFromWebPage(request.headers)) {
      return new Response("Forbidden", { status: 403 });
    }
    if (this.isBlocked(address)) {
      return new Response("Too many tries", { status: 429 });
    }
    if (this.inbound.size >= maxInbound) {
      return new Response("Busy", { status: 503 });
    }
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Teneo sync", { status: 426 });
    }
    const data: SocketData = { address, channel: null };
    return server.upgrade(request, { data })
      ? undefined
      : new Response("Bad request", { status: 400 });
  }

  private opened(
    data: SocketData,
    ws: {
      sendText(text: string): void;
      close(code?: number, reason?: string): void;
    },
  ): void {
    const channel = new SocketChannel({
      initiator: false,
      // no port: the one a device connects from means nothing for dialing it
      remoteAddress: data.address,
      socket: {
        send: (message) => ws.sendText(message),
        // txiki ends a server-side socket with no close frame, so the reason
        // goes first as a message (byeMessage), with a moment to be sent
        close: (reason) => {
          if (reason) ws.sendText(byeMessage(reason));
          setTimeout(() => ws.close(1000, reason), reason ? 100 : 0);
        },
      },
    });
    data.channel = channel;
    this.inbound.add(channel);
    const startedAt = Date.now();
    void this.options.engine.attach(channel).then((error) => {
      this.inbound.delete(channel);
      if (error && failedHandshake(error, Date.now() - startedAt)) {
        this.recordFailure(data.address);
      }
    });
  }

  private recordFailure(address: string): void {
    const times = this.failedHandshakes.get(address) ?? [];
    times.push(Date.now());
    this.failedHandshakes.set(address, times);
  }

  private isBlocked(address: string): boolean {
    const since = Date.now() - failureLimit.windowMs;
    const recent = (this.failedHandshakes.get(address) ?? []).filter(
      (time) => time > since,
    );
    if (recent.length === 0) this.failedHandshakes.delete(address);
    else this.failedHandshakes.set(address, recent);
    return recent.length >= failureLimit.count;
  }

  // --- dialing

  private found(device: DiscoveredDevice): void {
    this.discovered.set(device.deviceId, device);
    this.retry.delete(device.deviceId); // seen just now: worth trying at once
    void this.dial(device.deviceId, () => this.addressesOf(device.deviceId));
  }

  private connectedTo(deviceId: string): boolean {
    return this.options.engine
      .peers()
      .some((peer) => peer.deviceId === deviceId);
  }

  /** Where a device may be: what discovery saw, then where it was last. */
  private async addressesOf(deviceId: string): Promise<string[]> {
    const found = this.discovered.get(deviceId);
    const addresses = found
      ? found.addresses.map((address) => `${address}:${found.port}`)
      : [];
    const known = (await this.options.knownPeers()).find(
      (peer) => peer.deviceId === deviceId,
    );
    if (known?.lastAddress)
      addresses.push(...this.withPorts(known.lastAddress));
    return addresses;
  }

  private withPorts(address: string): string[] {
    return address.includes(":")
      ? [address]
      : (this.options.ports ?? syncPorts).map((port) => `${address}:${port}`);
  }

  /** On a phone's hotspot the gateway is the phone, which may be a device
   *  that is known but hasn't been seen. Not when a device is connected there
   *  already: every dial would open another connection to that same device,
   *  which replaces the one it has, every few seconds for as long as any
   *  known device stays away. */
  private async dialGateway(): Promise<void> {
    await this.dial("gateway", async () => {
      const gateway = await this.options.discovery.defaultGateway();
      if (!gateway) return [];
      const isConnectedThere = this.options.engine
        .peers()
        .some((peer) => isAtHost(peer.address, gateway));
      return isConnectedThere ? [] : this.withPorts(gateway);
    });
  }

  /** Connect to the first of `addresses` that answers, and stay on it until it
   *  ends. Does nothing while one is already made or being made for `key`, or
   *  while its wait after a failure is not over. */
  private async dial(
    key: string,
    addresses: () => Promise<string[]>,
  ): Promise<void> {
    if (this.stopped || key === this.options.deviceId) return;
    if (this.dialing.has(key) || this.connectedTo(key)) return;
    const retry = this.retry.get(key);
    if (retry && Date.now() < retry.notBefore) return;

    this.dialing.add(key);
    try {
      const targets = (await addresses()).filter((address) =>
        this.isLocal(address.slice(0, address.lastIndexOf(":"))),
      );
      let result = notConnected;
      for (const address of targets) {
        if (this.stopped) return;
        result = await this.connect(address);
        if (result.connected) break;
      }
      if (targets.length > 0) this.afterDial(key, result);
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.dialing.delete(key);
    }
  }

  /** Wait longer after each failure: a second, two, four, up to a minute. A
   *  connection that lasted is no failure, and is made again after a second. */
  private afterDial(key: string, result: ConnectResult): void {
    const failedHard =
      result.error !== null &&
      ["auth", "version", "protocol"].includes(result.error.code);
    // Both devices dialed at once: the engine kept the other connection and
    // closed this one at once. That is no failure (engine.ts prefersNew)
    const duplicate = result.connected && !failedHard && this.connectedTo(key);
    const healthy =
      duplicate ||
      (result.connected && result.lastedMs >= healthyMs && !failedHard);
    const failures = healthy ? 0 : (this.retry.get(key)?.failures ?? 0) + 1;
    const wait = healthy ? 1000 : Math.min(60_000, 1000 * 2 ** failures);
    this.retry.set(key, { failures, notBefore: Date.now() + wait });
  }

  /** Open a connection to `ip:port` and run it. Resolves when it ends; at once,
   *  not connected, when it could not be opened. */
  private connect(address: string): Promise<ConnectResult> {
    return new Promise((resolve) => {
      let socket: WebSocket;
      try {
        socket = new WebSocket(`ws://${address}`);
      } catch (error) {
        this.options.onError?.(error);
        resolve(notConnected);
        return;
      }
      this.outbound.add(socket);
      let openedAt = 0;
      const channel = new SocketChannel({
        initiator: true,
        remoteAddress: address,
        socket: {
          send: (message) => socket.send(message),
          close: (reason) => socket.close(1000, reason),
        },
      });
      const giveUp = setTimeout(() => closeQuietly(socket), connectTimeoutMs);

      socket.onopen = () => {
        clearTimeout(giveUp);
        openedAt = Date.now();
        void this.options.engine.attach(channel).then((error) =>
          resolve({
            connected: true,
            error,
            lastedMs: Date.now() - openedAt,
          }),
        );
      };
      socket.onmessage = (event) => {
        if (typeof event.data === "string") channel.deliver(event.data);
      };
      socket.onclose = (event) => {
        clearTimeout(giveUp);
        this.outbound.delete(socket);
        channel.ended(event.reason);
        if (openedAt === 0) resolve(notConnected);
      };
      socket.onerror = () => {}; // onclose follows
    });
  }

  // --- keeping up

  /** Every few seconds: look again for devices that are not connected, and
   *  notice that the network changed or the Mac slept, after which the old
   *  announcements and waits mean nothing. */
  private async maintain(): Promise<void> {
    if (this.stopped || this.maintaining) return;
    this.maintaining = true;
    try {
      const now = Date.now();
      // a timer that fires much later than it should means the Mac was asleep
      const slept = now - this.lastTick > maintainEveryMs * 3;
      this.lastTick = now;
      const signature = networkSignature();
      if (slept || signature !== this.networkSignature) {
        this.networkSignature = signature;
        this.retry.clear();
        this.options.discovery.restart();
      }

      const known = await this.options.knownPeers();
      const wanted = new Set([
        ...known.map((peer) => peer.deviceId),
        ...this.discovered.keys(),
      ]);
      for (const deviceId of wanted) {
        void this.dial(deviceId, () => this.addressesOf(deviceId));
      }
      if (known.some((peer) => !this.connectedTo(peer.deviceId))) {
        void this.dialGateway();
      }
    } catch (error) {
      this.options.onError?.(error);
    } finally {
      this.maintaining = false;
    }
  }
}

function failedHandshake(error: SyncError, lastedMs: number): boolean {
  return (
    ["auth", "protocol", "timeout"].includes(error.code) &&
    lastedMs < handshakeWindowMs
  );
}

async function portIsFree(port: number): Promise<boolean> {
  try {
    const listener = await tjs.listen("tcp", "0.0.0.0", port);
    listener.close();
    return true;
  } catch {
    return false;
  }
}

/** The IPv4 addresses this Mac has on its networks: when they change, so has
 *  the network. */
function networkSignature(): string {
  return tjs.system.networkInterfaces
    .filter(
      (face) => !face.internal && /^\d+\.\d+\.\d+\.\d+$/.test(face.address),
    )
    .map((face) => `${face.name}:${face.address}`)
    .sort()
    .join(",");
}

function closeQuietly(socket: WebSocket): void {
  try {
    socket.close();
  } catch {
    // already closed
  }
}
