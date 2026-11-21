import { describe, expect, test } from "bun:test";

import {
  Hlc,
  type Channel,
  SyncEngine,
  SyncError,
  type SyncErrorCode,
  fromHex,
  memoryChannelPair,
  randomBytes,
  toHex,
} from "@teneo/sync";
import { MemoryStore } from "@teneo/sync/testing";

import type { Timers } from "./transport";
import { PhoneTransport } from "./transport";

const phoneId = "a".repeat(32);
const macId = "b".repeat(32);
const otherId = "c".repeat(32);

/** Time that moves only when a test says so */
class FakeTimers implements Timers {
  time = 1_000_000;
  private tasks: {
    due: number;
    every?: number;
    run: () => void;
    id: number;
  }[] = [];
  private counter = 0;

  now = () => this.time;

  every(ms: number, task: () => void): () => void {
    const entry = {
      due: this.time + ms,
      every: ms,
      run: task,
      id: ++this.counter,
    };
    this.tasks.push(entry);
    return () => this.remove(entry.id);
  }

  after(ms: number, task: () => void): () => void {
    const entry = { due: this.time + ms, run: task, id: ++this.counter };
    this.tasks.push(entry);
    return () => this.remove(entry.id);
  }

  private remove(id: number): void {
    this.tasks = this.tasks.filter((entry) => entry.id !== id);
  }

  /** Moves time on, running what falls due on the way, in order */
  advance(ms: number): void {
    const target = this.time + ms;
    for (;;) {
      const next = this.tasks
        .filter((entry) => entry.due <= target)
        .sort((a, b) => a.due - b.due)[0];
      if (!next) break;
      this.time = Math.max(this.time, next.due);
      if (next.every) next.due += next.every;
      else this.remove(next.id);
      next.run();
    }
    this.time = target;
  }

  /** Time passes without any timer running: the phone was asleep */
  sleep(ms: number): void {
    this.time += ms;
  }
}

/** Lets promises settle */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const timers = new FakeTimers();
  const log = {
    ready: [] as [string, string][],
    connects: [] as string[],
    sends: [] as [number, string][],
    closes: [] as [number, string][],
    failedHandshakes: [] as string[],
    restarts: 0,
    errors: [] as unknown[],
  };
  let nextId = 1;
  let refuseConnects = false;
  let signature = "wlan0:10.0.0.9";
  let networks = 0;
  const native = {
    ready: (tag: string, deviceId: string) => log.ready.push([tag, deviceId]),
    connect: (address: string) => {
      log.connects.push(address);
      return refuseConnects ? -1 : nextId++;
    },
    send: (id: number, message: string) => {
      log.sends.push([id, message]);
      return true;
    },
    close: (id: number, reason: string) => log.closes.push([id, reason]),
    handshakeFailed: (address: string) => log.failedHandshakes.push(address),
    networkSignature: () => signature,
    restartDiscovery: () => {
      log.restarts += 1;
    },
  };

  const peers: { deviceId: string }[] = [];
  /** The devices sync was ended with, on either side */
  const disconnected = new Set<string>();
  const attached: {
    channel: Channel;
    end(error: SyncError | null): void;
    openedAt: number;
  }[] = [];
  const engine = {
    discoveryTag: async () => "tag1234",
    peers: () =>
      peers.map((peer) => ({ ...peer, name: "", platform: "", address: "" })),
    attach: (channel: Channel) =>
      new Promise<SyncError | null>((resolve) => {
        attached.push({ channel, end: resolve, openedAt: timers.now() });
      }),
  };
  const transport = new PhoneTransport({
    engine,
    deviceId: phoneId,
    native,
    timers,
    isDisconnected: (deviceId) => disconnected.has(deviceId),
    onError: (error) => log.errors.push(error),
  });
  return {
    timers,
    log,
    peers,
    disconnected,
    attached,
    transport,
    refuseConnects: (value: boolean) => (refuseConnects = value),
    changeNetwork: () => (signature = `wlan0:10.0.${++networks}.9`),
  };
}

const mac = (addresses = ["10.0.0.2"], port = 47823) => ({
  deviceId: macId,
  addresses,
  port,
});

/** Native code says the dial of `id` opened, and the engine runs it for `lastedMs` */
async function dialLasting(
  harness: ReturnType<typeof setup>,
  id: number,
  lastedMs: number,
  error: SyncError | null,
) {
  harness.transport.opened(id, "10.0.0.2:47823", true);
  const connection = harness.attached.at(-1)!;
  harness.timers.advance(lastedMs);
  connection.end(error);
  harness.transport.closed(id, "");
  await settle();
}

describe("starting", () => {
  test("native code is told the vault's tag and this device, and the clock starts", async () => {
    const { transport, log, timers } = setup();
    await transport.start();
    expect(log.ready).toEqual([["tag1234", phoneId]]);
    // every five seconds it looks again
    const before = log.restarts;
    timers.advance(5000);
    expect(log.restarts).toBe(before);
  });

  test("stopped before the tag is known, it never starts", async () => {
    const { transport, log } = setup();
    const starting = transport.start();
    transport.stop();
    await starting;
    expect(log.ready).toEqual([]);
  });
});

describe("dialing what Bonjour finds", () => {
  test("each address of the device is tried in turn until one opens", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac(["10.0.0.2", "10.0.0.3"], 47824));
    expect(harness.log.connects).toEqual(["10.0.0.2:47824"]);

    harness.transport.closed(1, ""); // refused
    await settle();
    expect(harness.log.connects).toEqual(["10.0.0.2:47824", "10.0.0.3:47824"]);

    harness.transport.opened(2, "10.0.0.3:47824", true);
    expect(harness.attached).toHaveLength(1);
    expect(harness.attached[0]!.channel.initiator).toBe(true);
    expect(harness.attached[0]!.channel.remoteAddress).toBe("10.0.0.3:47824");
  });

  test("it is not dialed while a dial is going on, or while it is connected", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    harness.transport.found(mac()); // found again at once
    expect(harness.log.connects).toHaveLength(1);

    harness.transport.opened(1, "10.0.0.2:47823", true);
    harness.peers.push({ deviceId: macId });
    harness.transport.found(mac());
    harness.timers.advance(5000);
    expect(harness.log.connects).toHaveLength(1);
  });

  test("this device is never dialed", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found({
      deviceId: phoneId,
      addresses: ["10.0.0.9"],
      port: 47823,
    });
    expect(harness.log.connects).toEqual([]);
  });

  test("a device sync was ended with is not dialed, until it is taken back", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.disconnected.add(macId);
    harness.transport.found(mac());
    harness.timers.advance(60_000);
    expect(harness.log.connects).toEqual([]);

    harness.disconnected.delete(macId);
    harness.timers.advance(5000);
    expect(harness.log.connects).toEqual(["10.0.0.2:47823"]);
  });

  test("when native code cannot start a dial, that is a failed dial", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.refuseConnects(true);
    harness.transport.found(mac());
    await settle();
    expect(harness.log.connects).toHaveLength(1);
    // and it waits two seconds before the next
    harness.timers.advance(1999);
    expect(harness.log.connects).toHaveLength(1);
    harness.timers.advance(5000);
    expect(harness.log.connects).toHaveLength(2);
  });

  test("a device that never answers is given up on", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    harness.timers.advance(10_000); // native code never says opened or closed
    await settle();
    expect(harness.log.closes).toEqual([[1, ""]]);
    // not "being dialed" for ever: after the wait it is tried again
    harness.timers.advance(5000);
    expect(harness.log.connects).toHaveLength(2);
  });
});

describe("waiting after a failure", () => {
  test("two seconds, four, eight... up to a minute", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    let id = 1;
    const waits: number[] = [];
    for (let round = 0; round < 8; round++) {
      harness.transport.closed(id++, ""); // refused
      await settle();
      const failedAt = harness.timers.now();
      const dialsBefore = harness.log.connects.length;
      // step in a second at a time to see when it dials again
      let waited = 0;
      while (harness.log.connects.length === dialsBefore && waited < 120_000) {
        harness.timers.advance(1000);
        waited += 1000;
      }
      waits.push(harness.timers.now() - failedAt);
    }
    // the checks run every five seconds, so a wait shows as the next check after it
    expect(waits.slice(0, 3)).toEqual([5000, 5000, 10_000]);
    expect(Math.max(...waits)).toBeLessThanOrEqual(65_000);
    expect(waits.at(-1)!).toBeGreaterThanOrEqual(60_000);
  });

  test("a device seen again by Bonjour is tried at once", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    harness.transport.closed(1, "");
    await settle();
    expect(harness.log.connects).toHaveLength(1);
    harness.transport.found(mac(["10.0.0.7"])); // it moved
    expect(harness.log.connects.at(-1)).toBe("10.0.0.7:47823");
  });

  test("a connection that lasted is no failure: it is made again after a second", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    await dialLasting(harness, 1, 60_000, new SyncError("timeout", "silent"));
    const dials = harness.log.connects.length;
    harness.timers.advance(999);
    expect(harness.log.connects).toHaveLength(dials);
    harness.timers.advance(5000);
    expect(harness.log.connects).toHaveLength(dials + 1);
  });

  test("a connection that ended at once counts as a failure", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    await dialLasting(harness, 1, 100, null);
    const dials = harness.log.connects.length;
    harness.timers.advance(1999);
    expect(harness.log.connects).toHaveLength(dials);
  });

  test("a dial closed at once because both devices dialed is no failure", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    // Five times the Mac's own dial wins: the engine keeps it and closes
    // this one. Counted as failures, the wait would be 32 seconds by now
    for (let round = 1; round <= 5; round++) {
      harness.peers.push({ deviceId: macId });
      await dialLasting(harness, round, 100, null);
      harness.peers.length = 0;
      harness.timers.advance(5000);
    }
    expect(harness.log.connects).toHaveLength(6);
  });

  test("a wrong key, version or protocol is a failure however long it lasted", async () => {
    for (const code of ["auth", "version", "protocol"] as SyncErrorCode[]) {
      const harness = setup();
      await harness.transport.start();
      harness.transport.found(mac());
      await dialLasting(harness, 1, 60_000, new SyncError(code, code));
      const dials = harness.log.connects.length;
      harness.timers.advance(1999);
      expect(harness.log.connects).toHaveLength(dials);
    }
  });
});

describe("connections that come in", () => {
  test("they are run by the engine, with no port in the address", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(7, "10.0.0.2", false);
    expect(harness.attached).toHaveLength(1);
    expect(harness.attached[0]!.channel.initiator).toBe(false);
    expect(harness.attached[0]!.channel.remoteAddress).toBe("10.0.0.2");
  });

  test("messages and the close reach the engine's channel, in order", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(7, "10.0.0.2", false);
    const channel = harness.attached[0]!.channel;
    const events: string[] = [];
    channel.onMessage((message) => events.push(message));
    channel.onClose((reason) => events.push(`closed ${reason}`));
    harness.transport.message(7, "hello");
    harness.transport.message(7, "proof");
    harness.transport.closed(7, "auth");
    expect(events).toEqual(["hello", "proof", "closed auth"]);
    channel.send("x");
    expect(harness.log.sends).toEqual([]); // ended: nothing goes out
  });

  test("what the engine sends goes to native code under the connection's number", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(7, "10.0.0.2", false);
    harness.attached[0]!.channel.send("hello");
    harness.attached[0]!.channel.close("protocol");
    expect(harness.log.sends).toEqual([[7, "hello"]]);
    expect(harness.log.closes).toEqual([[7, "protocol"]]);
  });

  test("a failed handshake soon after opening is reported, so the address can be refused", async () => {
    for (const code of ["auth", "protocol", "timeout"] as SyncErrorCode[]) {
      const harness = setup();
      await harness.transport.start();
      harness.transport.opened(7, "10.0.0.4", false);
      harness.timers.advance(2000);
      harness.attached[0]!.end(new SyncError(code, code));
      await settle();
      expect(harness.log.failedHandshakes).toEqual(["10.0.0.4"]);
    }
  });

  test("a failure after a long connection, a version mismatch or a plain close is not", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(1, "10.0.0.4", false);
    harness.timers.advance(10_000);
    harness.attached[0]!.end(new SyncError("auth", "late"));
    harness.transport.opened(2, "10.0.0.4", false);
    harness.attached[1]!.end(new SyncError("version", "other version"));
    harness.transport.opened(3, "10.0.0.4", false);
    harness.attached[2]!.end(new SyncError("closed", "gone"));
    harness.transport.opened(4, "10.0.0.4", false);
    harness.attached[3]!.end(null);
    await settle();
    expect(harness.log.failedHandshakes).toEqual([]);
  });

  test("one for a dial nobody is waiting for is closed", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(99, "10.0.0.2:47823", true);
    expect(harness.log.closes).toEqual([[99, ""]]);
    expect(harness.attached).toHaveLength(0);
  });
});

describe("keeping up", () => {
  test("a changed network restarts Bonjour and forgets the waits", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    harness.transport.closed(1, "");
    await settle();
    expect(harness.log.connects).toHaveLength(1);

    harness.changeNetwork();
    harness.timers.advance(5000);
    expect(harness.log.restarts).toBe(1);
    // the wait after the failure is forgotten: it is dialed again right away
    expect(harness.log.connects).toHaveLength(2);
  });

  test("an unchanged network restarts nothing", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.timers.advance(60_000);
    expect(harness.log.restarts).toBe(0);
  });

  test("a phone that slept restarts Bonjour, though the network looks the same", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.timers.sleep(60_000);
    harness.timers.advance(5000);
    expect(harness.log.restarts).toBe(1);
  });

  test("devices that are not connected are dialed again as the waits end", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.found(mac());
    harness.transport.closed(1, "");
    await settle();
    harness.timers.advance(5000);
    await settle();
    expect(harness.log.connects).toHaveLength(2);
  });
});

describe("stopping", () => {
  test("it closes every connection, ends the dials, and does nothing after", async () => {
    const harness = setup();
    await harness.transport.start();
    harness.transport.opened(7, "10.0.0.5", false);
    harness.transport.found(mac());
    harness.transport.stop();
    await settle();
    expect(harness.log.closes).toContainEqual([7, ""]);

    const dials = harness.log.connects.length;
    harness.transport.found(mac(["10.0.0.8"]));
    harness.timers.advance(60_000);
    expect(harness.log.connects).toHaveLength(dials);
    harness.transport.opened(8, "10.0.0.6", false);
    expect(harness.log.closes).toContainEqual([8, ""]);
  });
});

describe("with a real engine on the other end", () => {
  const vaultKey = randomBytes(32);

  function device(deviceId: string, name: string) {
    const clock = new Hlc(deviceId);
    const store = new MemoryStore(deviceId, clock, Date.now);
    const engine = new SyncEngine({
      deviceId,
      name,
      platform: "test",
      vaultKey,
      store,
      clock,
    });
    return { deviceId, store, engine };
  }

  async function until(condition: () => boolean, what: string): Promise<void> {
    for (let i = 0; i < 400; i++) {
      if (condition()) return;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`gave up waiting for ${what}`);
  }

  test("a dialed connection syncs both ways, and the dial is the initiator", async () => {
    const phone = device(toHex(fromHex(phoneId)!), "Phone");
    const peer = device(macId, "Mac");
    const links = new Map<number, ReturnType<typeof memoryChannelPair>>();
    let transport!: PhoneTransport;
    let nextId = 1;
    const native = {
      ready: () => {},
      connect: () => {
        const id = nextId++;
        const pair = memoryChannelPair();
        links.set(id, pair);
        // the other device is the responder of the pair
        void peer.engine.attach(pair.responder);
        // native code's events, as they come: after the call returns
        queueMicrotask(() => {
          transport.opened(id, "10.0.0.2:47823", true);
          pair.initiator.onMessage((message) => transport.message(id, message));
          pair.initiator.onClose((reason) =>
            transport.closed(id, reason ?? ""),
          );
        });
        return id;
      },
      send: (id: number, message: string) => {
        links.get(id)!.initiator.send(message);
        return true;
      },
      close: (id: number, reason: string) =>
        links.get(id)!.initiator.close(reason),
      handshakeFailed: () => {},
      networkSignature: () => "net",
      restartDiscovery: () => {},
    };
    transport = new PhoneTransport({
      engine: phone.engine,
      deviceId: phoneId,
      native,
    });
    await transport.start();

    transport.found({ deviceId: macId, addresses: ["10.0.0.2"], port: 47823 });
    await until(() => phone.engine.peers().length === 1, "the handshake");
    expect(phone.engine.peers()[0]!.name).toBe("Mac");

    peer.store.copy("from the Mac");
    peer.engine.localChanged();
    await until(
      () => phone.store.liveTexts().includes("from the Mac"),
      "the Mac's copy",
    );

    phone.store.copy("from the phone");
    phone.engine.localChanged();
    await until(
      () => peer.store.liveTexts().includes("from the phone"),
      "the phone's copy",
    );

    transport.stop();
    phone.engine.stop();
    peer.engine.stop();
  });

  test("a connection that came in syncs too, and a wrong key is reported as a failed handshake", async () => {
    const phone = device(phoneId, "Phone");
    const goodPeer = device(otherId, "Good");
    const failed: string[] = [];
    const links = new Map<number, ReturnType<typeof memoryChannelPair>>();
    let transport!: PhoneTransport;
    const native = {
      ready: () => {},
      connect: () => -1,
      send: (id: number, message: string) => {
        links.get(id)!.responder.send(message);
        return true;
      },
      close: (id: number, reason: string) =>
        links.get(id)!.responder.close(reason),
      handshakeFailed: (address: string) => failed.push(address),
      networkSignature: () => "net",
      restartDiscovery: () => {},
    };
    transport = new PhoneTransport({
      engine: phone.engine,
      deviceId: phoneId,
      native,
    });
    await transport.start();

    function comeIn(id: number, from: SyncEngine, address: string) {
      const pair = memoryChannelPair();
      links.set(id, pair);
      // the Mac (or a stranger) opened this one: it is the initiator
      void from.attach(pair.initiator);
      transport.opened(id, address, false);
      pair.responder.onMessage((message) => transport.message(id, message));
      pair.responder.onClose((reason) => transport.closed(id, reason ?? ""));
    }

    comeIn(1, goodPeer.engine, "10.0.0.2");
    await until(() => phone.engine.peers().length === 1, "the handshake");
    goodPeer.store.copy("hello phone");
    goodPeer.engine.localChanged();
    await until(
      () => phone.store.liveTexts().includes("hello phone"),
      "the copy",
    );

    const stranger = device(macId, "Stranger");
    const wrongKey = new SyncEngine({
      deviceId: macId,
      name: "Stranger",
      platform: "test",
      vaultKey: randomBytes(32),
      store: stranger.store,
    });
    comeIn(2, wrongKey, "10.0.0.66");
    await until(
      () => failed.length === 1,
      "the failed handshake to be reported",
    );
    expect(failed).toEqual(["10.0.0.66"]);

    transport.stop();
    phone.engine.stop();
    goodPeer.engine.stop();
    wrongKey.stop();
  });
});
