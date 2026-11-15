import { expect, test } from "bun:test";

import { memoryChannelPair } from "./channel";
import { maxTextBytes } from "./record";
import { type TestDevice, TestNetwork } from "./testing";

const live = (device: TestDevice) => device.store.liveTexts().sort();
const same = (...devices: TestDevice[]) => {
  for (const device of devices.slice(1)) {
    expect(device.store.snapshot()).toEqual(devices[0]!.store.snapshot());
  }
};

test("history made before two devices meet arrives, and so does what comes after", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  a.copy("one");
  b.copy("two");
  net.connect(a, b);
  await net.settle();
  expect(live(a)).toEqual(["one", "two"]);
  expect(live(b)).toEqual(["one", "two"]);

  a.copy("three");
  await net.settle();
  expect(live(b)).toEqual(["one", "three", "two"]);
  same(a, b);
  expect(b.engine.peers()).toMatchObject([
    { deviceId: a.id, name: "Device a", platform: "test" },
  ]);
  expect(b.itemsChanged).toBeGreaterThan(0);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("an item that came from a peer is not written back to it as a change", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  net.connect(a, b);
  a.copy("only once");
  await net.settle();
  expect(a.store.head).toBe(1); // the echo merged into nothing, so it wrote nothing
  expect(b.store.head).toBe(1);
  expect(a.itemsChanged).toBe(0);
  net.stop();
});

test("pinning, unpinning and deleting sync, and the latest pin wins", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  const id = a.copy("pin me");
  net.connect(a, b);
  await net.settle();

  a.pin(id, true);
  await net.settle();
  expect(b.store.snapshot()[0]!.pinned?.at).not.toBeNull();

  b.pin(id, false);
  await net.settle();
  expect(a.store.snapshot()[0]!.pinned?.at).toBeNull();

  a.pin(id, true);
  await net.settle();
  same(a, b);
  expect(b.store.snapshot()[0]!.pinned?.at).not.toBeNull();

  b.remove(id);
  await net.settle();
  expect(a.store.snapshot()[0]).toMatchObject({ text: null });
  expect(a.store.snapshot()[0]!.deletedAt).not.toBeNull();
  expect(live(a)).toEqual([]);
  same(a, b);
  net.stop();
});

test("a delete is permanent: a later pin or a reconnect cannot bring the item back", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  const id = a.copy("delete me");
  net.connect(a, b);
  await net.settle();
  net.disconnect(a, b);

  a.remove(id);
  b.pin(id, true); // made without knowing about the delete
  net.connect(b, a);
  await net.settle();
  same(a, b);
  expect(live(b)).toEqual([]);
  expect(b.store.snapshot()[0]).toMatchObject({ text: null });

  // copying the same text again is a new item
  a.copy("delete me");
  await net.settle();
  expect(live(b)).toEqual(["delete me"]);
  net.stop();
});

test("the same text copied on two devices ends up as one item", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  a.copy("same", { id: "aaaa-1" });
  b.copy("same", { id: "bbbb-1" });
  const laterCopy = Math.max(...b.store.snapshot().map((r) => r.dateCopied));
  net.connect(a, b);
  await net.settle();

  same(a, b);
  expect(live(a)).toEqual(["same"]);
  const records = a.store.snapshot();
  expect(records.find((r) => r.id === "aaaa-1")).toMatchObject({
    deletedAt: null,
    dateCopied: laterCopy,
  });
  expect(records.find((r) => r.id === "bbbb-1")).toMatchObject({ text: null });
  expect(records.find((r) => r.id === "bbbb-1")!.deletedAt).not.toBeNull();
  net.stop();
});

test("a pinned item is never folded into a copy of the same text", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  const kept = a.copy("same", { id: "aaaa-1" });
  a.pin(kept, true);
  b.copy("same", { id: "bbbb-1" });
  net.connect(a, b);
  await net.settle();
  expect(live(a)).toEqual(["same", "same"]);
  same(a, b);
  net.stop();
});

test("a middle device passes changes between two that never meet", async () => {
  const net = new TestNetwork();
  const [a, b, c] = [net.add("a"), net.add("b"), net.add("c")];
  net.connect(a, b);
  net.connect(c, b);
  const fromA = a.copy("from a");
  c.copy("from c");
  await net.settle();
  expect(live(a)).toEqual(["from a", "from c"]);
  expect(live(c)).toEqual(["from a", "from c"]);

  c.pin(fromA, true);
  a.copy("later");
  await net.settle();
  expect(
    a.store.snapshot().find((r) => r.id === fromA)!.pinned?.at,
  ).not.toBeNull();
  same(a, b, c);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("a wiped device gets its history back, and its new items are not mistaken for old", async () => {
  const net = new TestNetwork();
  let a = net.add("a");
  const b = net.add("b");
  a.copy("a1");
  a.copy("a2");
  b.copy("b1");
  net.connect(a, b);
  await net.settle();
  net.disconnect(a, b);

  // new store, new epoch, counter back at zero: below what b has read
  a = net.wipe("a");
  a.copy("fresh 1");
  a.copy("fresh 2");
  net.connect(a, b);
  await net.settle();
  expect(live(b)).toEqual(["a1", "a2", "b1", "fresh 1", "fresh 2"]);
  same(a, b);
  net.stop();
});

test("a peer's changes arrive in batches of at most 200", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  for (let i = 0; i < 450; i++) a.store.copy(`item ${i}`);
  net.connect(a, b);
  await net.settle();
  expect(
    b.store.cursorSaves
      .filter((save) => save.deviceId === a.id)
      .map((save) => save.seq),
  ).toEqual([200, 400, 450]);
  expect(live(b)).toHaveLength(450);
  same(a, b);
  net.stop();
});

test("a batch also stops at 256 KB", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  for (let i = 0; i < 5; i++) a.store.copy(`${i}`.repeat(100_000));
  net.connect(a, b);
  await net.settle();
  expect(
    b.store.cursorSaves
      .filter((save) => save.deviceId === a.id)
      .map((save) => save.seq),
  ).toEqual([2, 4, 5]);
  expect(live(b)).toHaveLength(5);
  net.stop();
});

test("a text over 1 MB stays put, and the cursor still moves past it", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  a.copy("x".repeat(maxTextBytes + 1));
  a.copy("small");
  net.connect(a, b);
  await net.settle();
  expect(live(b)).toEqual(["small"]);
  expect(b.store.cursorSaves.at(-1)!.seq).toBe(a.store.head);

  a.copy("x".repeat(maxTextBytes)); // exactly the limit still goes
  await net.settle();
  expect(live(b)).toHaveLength(2);
  net.stop();
});

test("the cursor moves past rows that never sync, such as images", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  a.store.copy("a text");
  a.store.imagesCopied(2); // two screenshots after it
  net.connect(a, b);
  await net.settle();
  expect(a.store.head).toBe(3);
  expect(
    b.store.cursorSaves
      .filter((save) => save.deviceId === a.id)
      .map((save) => save.seq),
  ).toEqual([3]);
  net.stop();
});

test("items with detected secrets stay home until the user allows them, deletes always go", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  const key = a.copy("sk-live-1234", { secret: true });
  a.copy("an ordinary note");
  net.connect(a, b);
  await net.settle();
  expect(live(b)).toEqual(["an ordinary note"]);
  expect(b.store.has(key)).toBe(false);

  a.allowSecrets(true);
  await net.settle();
  expect(live(b)).toEqual(["an ordinary note", "sk-live-1234"]);

  // turned off again, a delete of a secret still reaches the other device
  a.allowSecrets(false);
  const hidden = a.copy("another-secret", { secret: true });
  a.remove(hidden);
  await net.settle();
  expect(b.store.snapshot().find((r) => r.id === hidden)).toMatchObject({
    text: null,
  });
  net.stop();
});

test("a device's own history limit trims locally and is never synced", async () => {
  const net = new TestNetwork();
  const a = net.add("a");
  const b = net.add("b", { historyLimit: 3 });
  for (let i = 1; i <= 6; i++) a.store.copy(`copy ${i}`);
  net.connect(a, b);
  await net.settle();
  expect(live(b)).toEqual(["copy 4", "copy 5", "copy 6"]);
  expect(live(a)).toHaveLength(6); // nothing was deleted over there
  expect(b.store.trimCount).toBeGreaterThan(0);
  net.stop();
});

test("a batch and its cursor are saved together, so a failure applies none of it", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  for (const text of ["one", "two", "three"]) a.store.copy(text);
  b.store.failPutNumber = 2;
  net.connect(a, b);
  await net.settle();
  expect(b.store.snapshot()).toEqual([]);
  expect(b.store.cursorSaves).toEqual([]);
  expect(net.errors).toHaveLength(1);

  net.errors.length = 0;
  b.store.failPutNumber = null;
  net.connect(a, b);
  await net.settle();
  expect(live(b)).toEqual(["one", "three", "two"]);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("a reconnect continues where the last batch ended", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  net.connect(a, b);
  for (let i = 0; i < 5; i++) a.copy(`first ${i}`);
  await net.settle();
  net.disconnect(a, b);
  a.copy("while apart");
  net.connect(b, a); // the other side opens this time
  await net.settle();
  expect(live(b)).toHaveLength(6);
  // only the new item crossed: one more cursor save after the first sync
  const saves = b.store.cursorSaves.filter((save) => save.deviceId === a.id);
  expect(saves.at(-1)!.seq).toBe(a.store.head);
  same(a, b);
  net.stop();
});

test("two devices opening a connection to each other at once keep one", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  net.connect(a, b);
  net.connect(b, a);
  await net.settle();
  expect(a.engine.peers()).toHaveLength(1);
  expect(b.engine.peers()).toHaveLength(1);

  a.copy("still flowing");
  b.copy("both ways");
  await net.settle();
  expect(live(a)).toEqual(["both ways", "still flowing"]);
  same(a, b);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("a device holding another vault's key gets nothing and sends nothing", async () => {
  const [netA, netB] = [new TestNetwork(), new TestNetwork()];
  const [a, b] = [netA.add("a"), netB.add("b")];
  a.copy("private");
  b.copy("also private");
  const pair = memoryChannelPair();
  const results = await Promise.all([
    a.engine.attach(pair.initiator),
    b.engine.attach(pair.responder),
  ]);
  expect(results.map((error) => error?.code)).toEqual(["auth", "auth"]);
  expect(live(a)).toEqual(["private"]);
  expect(live(b)).toEqual(["also private"]);
});

test("a stopped engine refuses connections", async () => {
  const net = new TestNetwork();
  const [a, b] = [net.add("a"), net.add("b")];
  a.engine.stop();
  const pair = memoryChannelPair();
  void b.engine.attach(pair.responder);
  const error = await a.engine.attach(pair.initiator);
  expect(error?.code).toBe("closed");
  b.engine.stop();
});

// --- many devices, random edits

function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

for (const seed of [11, 12, 13, 14]) {
  test(`devices that stay connected keep up with random edits (seed ${seed})`, async () => {
    const random = seeded(seed);
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
    const net = new TestNetwork();
    const devices = [net.add("a"), net.add("b"), net.add("c")] as [
      TestDevice,
      TestDevice,
      TestDevice,
    ];
    net.connect(devices[0], devices[1]);
    net.connect(devices[1], devices[2]);
    net.connect(devices[0], devices[2]);
    await net.settle();
    const words = ["alpha", "beta", "gamma"];

    for (let step = 0; step < 80; step++) {
      const device = pick(devices);
      const liveIds = device.store
        .snapshot()
        .filter((record) => record.deletedAt === null)
        .map((record) => record.id);
      const roll = random();
      if (roll < 0.5)
        device.copy(random() < 0.6 ? pick(words) : `${pick(words)} ${step}`);
      else if (roll < 0.75 && liveIds.length > 0)
        device.pin(pick(liveIds), random() < 0.6);
      else if (liveIds.length > 0) device.remove(pick(liveIds));
      if (random() < 0.25) await net.settle();
    }
    await net.settle();

    same(...devices);
    expect(devices[0].store.snapshot().length).toBeGreaterThan(0);
    expect(net.errors).toEqual([]);
    net.stop();
  });
}

for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
  test(`three devices converge after random copies, pins, deletes and disconnects (seed ${seed})`, async () => {
    const random = seeded(seed);
    const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
    const net = new TestNetwork();
    const devices = [net.add("a"), net.add("b"), net.add("c")];
    const [a, b, c] = devices as [TestDevice, TestDevice, TestDevice];
    const pairs: [TestDevice, TestDevice][] = [
      [a, b],
      [b, c],
      [a, c],
    ];
    // few words, so the same text is often copied on different devices
    const words = ["alpha", "beta", "gamma", "delta", "epsilon"];

    for (let step = 0; step < 60; step++) {
      const roll = random();
      const device = pick(devices);
      const liveIds = device.store
        .snapshot()
        .filter((record) => record.deletedAt === null)
        .map((record) => record.id);
      if (roll < 0.35) {
        device.copy(random() < 0.5 ? pick(words) : `${pick(words)} ${step}`);
      } else if (roll < 0.5 && liveIds.length > 0) {
        device.pin(pick(liveIds), random() < 0.6);
      } else if (roll < 0.62 && liveIds.length > 0) {
        device.remove(pick(liveIds));
      } else if (roll < 0.85) {
        const [x, y] = pick(pairs);
        if (net.isConnected(x, y)) net.disconnect(x, y);
        else if (random() < 0.5) net.connect(x, y);
        else net.connect(y, x);
      } else {
        await net.settle();
      }
    }

    for (const [x, y] of pairs) if (!net.isConnected(x, y)) net.connect(x, y);
    await net.settle();

    same(a, b, c);
    expect(a.store.snapshot().length).toBeGreaterThan(0);
    expect(net.errors).toEqual([]);
    net.stop();
  });
}

// --- what came after the first release: a device's maker, and app icons

const png = (...body: number[]) =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...body]);

/** A Mac's icons by app name, and what was asked of it */
function iconSource(icons: Record<string, Uint8Array>) {
  const asked: string[] = [];
  return {
    asked,
    icon: async (name: string) => {
      asked.push(name);
      return icons[name] ?? null;
    },
  };
}

/** A phone's saved icons */
function iconSink(saved = new Map<string, Uint8Array>()) {
  return {
    saved,
    missing: async (names: string[]) =>
      names.filter((name) => !saved.has(name)),
    save: async (name: string, icon: Uint8Array) => {
      saved.set(name, icon);
    },
  };
}

test("a device that says who made it is known by it, and one that doesn't is not", async () => {
  const net = new TestNetwork();
  const mac = net.add("a");
  const phone = net.add("b", { maker: "google" });
  net.connect(mac, phone);
  await net.settle();
  expect(mac.engine.peers()).toMatchObject([{ maker: "google" }]);
  expect(phone.engine.peers()).toMatchObject([{ maker: "" }]);
  expect((await mac.store.getPeer(phone.id))?.maker).toBe("google");
  expect(net.errors).toEqual([]);
  net.stop();
});

test("a phone gets the icon of each app its items were copied from, once", async () => {
  const net = new TestNetwork();
  const source = iconSource({ Safari: png(1), Notes: png(2) });
  const sink = iconSink();
  const mac = net.add("a", { iconSource: source });
  const phone = net.add("b", { iconSink: sink });
  mac.copy("one", { sourceApp: "Safari" });
  mac.copy("two", { sourceApp: "Safari" });
  mac.copy("three", { sourceApp: "Unknown App" });
  net.connect(mac, phone);
  await net.settle();
  expect([...sink.saved.keys()]).toEqual(["Safari"]);
  expect(sink.saved.get("Safari")).toEqual(png(1));
  expect(phone.iconsChanged).toBe(1);

  // an app it has, or has asked this Mac for, is not asked for again
  mac.copy("four", { sourceApp: "Safari" });
  mac.copy("five", { sourceApp: "Unknown App" });
  mac.copy("six", { sourceApp: "Notes" });
  await net.settle();
  expect(source.asked.sort()).toEqual(["Notes", "Safari", "Unknown App"]);
  expect([...sink.saved.keys()].sort()).toEqual(["Notes", "Safari"]);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("icons are asked for in batches, however many apps there are", async () => {
  const net = new TestNetwork();
  const names = Array.from({ length: 70 }, (_, index) => `App ${index}`);
  const source = iconSource(
    Object.fromEntries(names.map((name, index) => [name, png(index)])),
  );
  const sink = iconSink();
  const mac = net.add("a", { iconSource: source });
  const phone = net.add("b", { iconSink: sink });
  for (const name of names) mac.copy(`from ${name}`, { sourceApp: name });
  net.connect(mac, phone);
  await net.settle();
  expect(sink.saved.size).toBe(70);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("a device that offers no icons is never asked, and sync goes on", async () => {
  const net = new TestNetwork();
  const sink = iconSink();
  // an older Teneo, or another phone: it would close over a frame it doesn't know
  const old = net.add("a");
  const phone = net.add("b", { iconSink: sink });
  old.copy("one", { sourceApp: "Safari" });
  net.connect(old, phone);
  await net.settle();
  expect(live(phone)).toEqual(["one"]);
  expect(sink.saved.size).toBe(0);
  expect(net.isConnected(old, phone)).toBe(true);
  expect(net.errors).toEqual([]);
  net.stop();
});

test("an icon that isn't a small png is not saved, and one that fails to save doesn't end sync", async () => {
  const net = new TestNetwork();
  const source = iconSource({
    Fake: new TextEncoder().encode("<svg onload=alert(1)>"),
    Huge: png(...Array.from({ length: 70 * 1024 }, () => 0)),
    Good: png(1),
    Unsavable: png(2),
  });
  const sink = iconSink();
  const save = sink.save;
  sink.save = async (name, icon) => {
    if (name === "Unsavable") throw new Error("disk full");
    await save(name, icon);
  };
  const mac = net.add("a", { iconSource: source });
  const phone = net.add("b", { iconSink: sink });
  for (const name of ["Fake", "Huge", "Good", "Unsavable"]) {
    mac.copy(`from ${name}`, { sourceApp: name });
  }
  net.connect(mac, phone);
  await net.settle();
  expect([...sink.saved.keys()]).toEqual(["Good"]);
  expect(live(phone)).toHaveLength(4);
  expect(net.errors.map(String)).toEqual(["Error: disk full"]);
  net.stop();
});
