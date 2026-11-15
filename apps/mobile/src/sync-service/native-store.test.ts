import { describe, expect, test } from "bun:test";

import { detectionVersion } from "@teneo/shared/detection/version";
import {
  type ItemRecord,
  type MemoryPair,
  SyncEngine,
  memoryChannelPair,
} from "@teneo/sync";
import { TestNetwork } from "@teneo/sync/testing";

import { FakeHistory } from "./fake-history";
import { HistoryBridge, type WireRow } from "./history-bridge";
import { NativeSyncStore } from "./native-store";
import { openSyncStore } from "./store";

const phone = "c".repeat(32);
const mac = "a".repeat(32);
const secretText = "postgres://user:pa55@db.example.com/app";

function setup() {
  let tick = 1_000_000_000_000;
  const now = () => ++tick;
  const history = new FakeHistory(phone, now);
  const store = new NativeSyncStore(new HistoryBridge(history), phone);
  return { history, store, now };
}

function record(id: string, text: string, now = 5000): ItemRecord {
  return {
    id,
    kind: "text",
    text,
    createdAt: now,
    origin: mac,
    dateCopied: now,
    sourceApp: null,
    pinned: null,
    deletedAt: null,
  };
}

const stamp = (wall: number, device = mac) =>
  `${wall.toString(16).padStart(12, "0")}-0000-${device}`;

describe("what the database gives the engine", () => {
  test("the device id and the epoch are the ones made with the database", async () => {
    const { history } = setup();
    const opened = openSyncStore(history);
    expect(opened.deviceId).toBe(phone);
    expect(await opened.store.epoch()).toBe(history.epoch);
  });

  test("changes come oldest first, with the head, tombstones included", async () => {
    const { history, store } = setup();
    const a = history.copy("one");
    history.copy("two");
    history.remove(a);

    const { changes, head } = await store.changesAfter(0, 10);
    // `one` was changed by its delete, so it comes after `two`
    expect(
      changes.map((c) => [c.record.text, c.record.deletedAt !== null]),
    ).toEqual([
      ["two", false],
      [null, true],
    ]);
    expect(changes.map((c) => c.seq)).toEqual([2, 3]);
    expect(head).toBe(history.head);

    const after = await store.changesAfter(2, 10);
    expect(after.changes.map((c) => c.seq)).toEqual([3]);
  });

  test("at most `limit` changes, and the head reaches past what was left out", async () => {
    const { history, store } = setup();
    history.copy("one");
    history.copy("two");
    history.copy("three");
    const { changes } = await store.changesAfter(0, 2);
    expect(changes.map((c) => c.record.text)).toEqual(["one", "two"]);
  });

  test("a text too long to send is left out, and does not count against the limit", async () => {
    const { history, store } = setup();
    history.copy("a".repeat(1024 * 1024 + 1));
    history.copy("small one");
    history.copy("small two");
    const { changes, head } = await store.changesAfter(0, 2);
    expect(changes.map((c) => c.record.text)).toEqual([
      "small one",
      "small two",
    ]);
    expect(head).toBe(3);
  });

  test("an answer cut short to stay small does not end the changes", async () => {
    const { history, store } = setup();
    history.maxChars = 8;
    for (const text of ["aaaaaaaa", "bbbbbbbb", "cccccccc", "dddddddd"]) {
      history.copy(text);
    }
    const { changes } = await store.changesAfter(0, 3);
    expect(changes.map((c) => c.record.text)).toEqual([
      "aaaaaaaa",
      "bbbbbbbb",
      "cccccccc",
    ]);
    const rest = await store.changesAfter(3, 3);
    expect(rest.changes.map((c) => c.record.text)).toEqual(["dddddddd"]);
  });

  test("a copy nobody has looked at is looked at before it is sent, and what is found is kept", async () => {
    const { history, store } = setup();
    history.copy("plain words");
    history.copy(secretText);
    const headBefore = history.head;

    const { changes } = await store.changesAfter(0, 10);
    expect(changes.map((c) => c.hasSecret)).toEqual([false, true]);

    // the app finds the same when it lists: it is stored, with the rules' version
    const stored = [...history.rows.values()].find(
      (row) => row.value === secretText,
    )!;
    expect(stored.detectorVersion).toBe(detectionVersion);
    const [span] = JSON.parse(stored.secrets!) as {
      start: number;
      end: number;
    }[];
    expect(secretText.slice(span!.start, span!.end)).toBe("pa55");
    // looking is not news for the other devices
    expect(history.head).toBe(headBefore);
  });

  test("a link is found and kept too", async () => {
    const { history, store } = setup();
    history.copy("https://www.example.org/page");
    await store.changesAfter(0, 10);
    const [row] = [...history.rows.values()];
    expect([row!.linkUrl, row!.linkHost]).toEqual([
      "https://www.example.org/page",
      "example.org",
    ]);
  });

  test("a text already looked at is not looked at again", async () => {
    const { history, store } = setup();
    history.copy(secretText);
    await store.changesAfter(0, 10);
    expect(history.detectionCalls).toHaveLength(1);
    const again = await store.changesAfter(0, 10);
    expect(history.detectionCalls).toHaveLength(1);
    expect(again.changes[0]!.hasSecret).toBe(true);
  });

  test("a text that older rules looked at is looked at again", async () => {
    const { history, store } = setup();
    const id = history.copy(secretText);
    const row = history.rows.get(id)!;
    history.rows.set(id, {
      ...row,
      secrets: null,
      detectorVersion: detectionVersion - 1,
    });
    const { changes } = await store.changesAfter(0, 10);
    expect(changes[0]!.hasSecret).toBe(true);
  });

  test("a deleted text is not looked at", async () => {
    const { history, store } = setup();
    history.remove(history.copy("gone"));
    await store.changesAfter(0, 10);
    expect(history.detectionCalls).toHaveLength(0);
  });
});

describe("devices met", () => {
  test("an unknown device is none, and a patch makes it and changes only what it names", async () => {
    const { store } = setup();
    expect(await store.getPeer(mac)).toBeNull();
    await store.transaction((tx) =>
      tx.updatePeer(mac, { name: "Mac", platform: "macos", lastSeenAt: 7 }),
    );
    await store.transaction((tx) =>
      tx.updatePeer(mac, { epoch: "abc", receivedSeq: 4, name: undefined }),
    );
    expect(await store.getPeer(mac)).toEqual({
      deviceId: mac,
      name: "Mac",
      platform: "macos",
      epoch: "abc",
      receivedSeq: 4,
      lastAddress: null,
      lastSeenAt: 7,
    });
    await store.transaction((tx) => tx.updatePeer(mac, { epoch: null }));
    expect((await store.getPeer(mac))?.epoch).toBeNull();
  });

  test("two patches in one transaction are one", async () => {
    const { store } = setup();
    await store.transaction(async (tx) => {
      await tx.updatePeer(mac, { name: "Mac" });
      await tx.updatePeer(mac, { receivedSeq: 9 });
    });
    expect(await store.getPeer(mac)).toMatchObject({
      name: "Mac",
      receivedSeq: 9,
    });
  });
});

describe("a transaction", () => {
  test("is all or nothing: a failure saves neither the items nor the cursor", async () => {
    const { history, store } = setup();
    history.copy("already here");
    const before = history.head;
    await expect(
      store.transaction(async (tx) => {
        await tx.put(record("r1", "new"));
        await tx.updatePeer(mac, { receivedSeq: 5 });
        throw new Error("The disk is full");
      }),
    ).rejects.toThrow("The disk is full");
    expect(history.head).toBe(before);
    expect(history.rows.has("r1")).toBe(false);
    expect(history.peers.size).toBe(0);
  });

  test("saves the items and the cursor together, each item with its own change number", async () => {
    const { history, store } = setup();
    await store.transaction(async (tx) => {
      await tx.put(record("r1", "one"));
      await tx.put(record("r2", "two"));
      await tx.updatePeer(mac, { epoch: "x", receivedSeq: 2 });
    });
    expect(history.rows.get("r1")!.syncSeq).toBe(1);
    expect(history.rows.get("r2")!.syncSeq).toBe(2);
    expect(history.peers.get(mac)?.receivedSeq).toBe(2);
    expect(history.commitCalls).toBe(1);
  });

  test("reads what it has written", async () => {
    const { store } = setup();
    await store.transaction(async (tx) => {
      await tx.put(record("r1", "one"));
      expect((await tx.get("r1"))?.text).toBe("one");
      await tx.put({ ...record("r1", "one"), dateCopied: 9000 });
      expect((await tx.get("r1"))?.dateCopied).toBe(9000);
      expect(await tx.get("nothing")).toBeNull();
    });
  });

  test("the newest unpinned weighs what was written against what is saved", async () => {
    const { history, store } = setup();
    history.copy("saved");
    const savedId = [...history.rows.keys()][0]!;
    await store.transaction(async (tx) => {
      expect((await tx.newestUnpinned())?.text).toBe("saved");
      // newer than the saved one: it is the newest now
      await tx.put(record("r1", "newer", 9_000_000_000_000));
      expect((await tx.newestUnpinned())?.text).toBe("newer");
      // an older one is not
      await tx.put(record("r2", "older", 1));
      expect((await tx.newestUnpinned())?.text).toBe("newer");
      // pinned or deleted, it is not unpinned any more
      await tx.put({
        ...record("r1", "newer", 9_000_000_000_000),
        pinned: { at: 10, stamp: stamp(10) },
      });
      expect((await tx.newestUnpinned())?.text).toBe("saved");
      // a saved row that was written over is not the one saved: its new copy is
      await tx.put({
        ...record(savedId, "saved", 1),
        text: null,
        deletedAt: 3,
        pinned: null,
      });
      expect((await tx.newestUnpinned())?.text).toBe("older");
    });
  });

  test("a new row is stored as the record says, and one that is there keeps who copied it first", async () => {
    const { history, store } = setup();
    await store.transaction((tx) =>
      tx.put({
        ...record("r1", "one", 100),
        createdAt: 50,
        sourceApp: "Notes",
      }),
    );
    expect(history.rows.get("r1")).toMatchObject({
      value: "one",
      createdAt: 50,
      originDevice: mac,
      dateCopied: 100,
      sourceAppName: "Notes",
      sourceAppBundleId: null,
      deletedAt: null,
    });
    // the same item again, from someone else's point of view
    await store.transaction((tx) =>
      tx.put({
        ...record("r1", "one", 200),
        // a row keeps who copied it first and when, whatever a later write says
        createdAt: 99,
        origin: phone,
        sourceApp: "Notes",
      }),
    );
    expect(history.rows.get("r1")).toMatchObject({
      createdAt: 50,
      originDevice: mac,
      dateCopied: 200,
    });
  });

  test("the bundle id stays while the app stays, and goes when it changes", async () => {
    const { history, store } = setup();
    await store.transaction((tx) =>
      tx.put({ ...record("r1", "one"), sourceApp: "Notes" }),
    );
    history.rows.set("r1", {
      ...history.rows.get("r1")!,
      sourceAppBundleId: "com.notes",
    });
    await store.transaction((tx) =>
      tx.put({ ...record("r1", "one"), sourceApp: "Notes", dateCopied: 6000 }),
    );
    expect(history.rows.get("r1")!.sourceAppBundleId).toBe("com.notes");
    await store.transaction((tx) =>
      tx.put({ ...record("r1", "one"), sourceApp: "Mail", dateCopied: 7000 }),
    );
    expect(history.rows.get("r1")!.sourceAppBundleId).toBeNull();
  });

  test("a text that arrives is looked at, and stored with what was found and the version", async () => {
    const { history, store } = setup();
    await store.transaction(async (tx) => {
      await tx.put(record("r1", secretText));
      await tx.put(record("r2", "https://example.org/a"));
      await tx.put(record("r3", "nothing special"));
    });
    const stored = (id: string): WireRow => history.rows.get(id)!;
    const [span] = JSON.parse(stored("r1").secrets!) as {
      start: number;
      end: number;
    }[];
    expect(secretText.slice(span!.start, span!.end)).toBe("pa55");
    expect(stored("r1").detectorVersion).toBe(detectionVersion);
    expect([stored("r2").linkUrl, stored("r2").linkHost]).toEqual([
      "https://example.org/a",
      "example.org",
    ]);
    expect(stored("r3")).toMatchObject({
      secrets: null,
      linkUrl: null,
      detectorVersion: detectionVersion,
    });
    // and it is held back from the others until the user allows secrets
    const { changes } = await store.changesAfter(0, 10);
    expect(changes.map((c) => c.hasSecret)).toEqual([true, false, false]);
  });

  test("a pin changes nothing of what was found in the text", async () => {
    const { history, store } = setup();
    await store.transaction((tx) => tx.put(record("r1", secretText)));
    const found = history.rows.get("r1")!.secrets;
    await store.transaction((tx) =>
      tx.put({
        ...record("r1", secretText),
        pinned: { at: 6000, stamp: stamp(6000) },
      }),
    );
    expect(history.rows.get("r1")).toMatchObject({
      secrets: found,
      detectorVersion: detectionVersion,
      pinnedAt: 6000,
      pinnedStamp: stamp(6000),
    });
  });

  test("a tombstone drops the text and what was found in it, keeps the stamp, and is not pinned", async () => {
    const { history, store } = setup();
    await store.transaction((tx) =>
      tx.put({
        ...record("r1", secretText),
        pinned: { at: 6000, stamp: stamp(6000) },
      }),
    );
    await store.transaction((tx) =>
      tx.put({
        ...record("r1", secretText),
        text: null,
        deletedAt: 7000,
        pinned: { at: null, stamp: stamp(7000) },
      }),
    );
    expect(history.rows.get("r1")).toMatchObject({
      value: null,
      secrets: null,
      linkUrl: null,
      pinnedAt: null,
      pinnedStamp: stamp(7000),
      deletedAt: 7000,
    });
    expect((await store.changesAfter(0, 10)).changes[0]!.record).toMatchObject({
      text: null,
      pinned: { at: null, stamp: stamp(7000) },
    });
  });

  test("starts again on what is there now when the app wrote to the history meanwhile", async () => {
    const { history, store } = setup();
    const id = history.copy("mine");
    let runs = 0;
    let wrote = false;
    // the app unpins at the moment the core is about to save
    history.beforeCommit = () => {
      if (wrote) return;
      wrote = true;
      history.pin(id, true);
    };
    const seen: (number | null | undefined)[] = [];
    await store.transaction(async (tx) => {
      runs += 1;
      seen.push((await tx.get(id))?.pinned?.at);
      await tx.put({ ...record("r1", "from a peer"), dateCopied: 10 });
    });
    expect(runs).toBe(2);
    // the second run saw the pin the first did not
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeGreaterThan(0);
    expect(history.rows.get(id)!.pinnedAt).not.toBeNull();
    expect(history.rows.has("r1")).toBe(true);
  });

  test("gives up when the history never stops changing, saving nothing", async () => {
    const { history, store } = setup();
    history.copy("mine");
    history.beforeCommit = () => history.copy(`more ${history.head}`);
    const before = history.rows.size;
    await expect(
      store.transaction(async (tx) => {
        await tx.get("mine");
        await tx.put(record("r1", "never"));
      }),
    ).rejects.toThrow("kept changing");
    expect(history.rows.has("r1")).toBe(false);
    expect(history.rows.size).toBe(before + history.commitCalls);
  });

  test("one that only moves a cursor does not depend on what the app does", async () => {
    const { history, store } = setup();
    history.beforeCommit = () => history.copy("typed meanwhile");
    await store.transaction((tx) => tx.updatePeer(mac, { receivedSeq: 3 }));
    expect(history.commitCalls).toBe(1);
    expect(history.peers.get(mac)?.receivedSeq).toBe(3);
  });

  test("one that writes nothing asks nothing of the database", async () => {
    const { history, store } = setup();
    await store.transaction(async (tx) => {
      await tx.get("nothing");
      await tx.newestUnpinned();
    });
    expect(history.commitCalls).toBe(0);
  });

  test("waits for the one before it, and then reads what that wrote", async () => {
    const { store } = setup();
    const first = store.transaction(async (tx) => {
      await Promise.resolve();
      await tx.put(record("r1", "first"));
    });
    const second = store.transaction(async (tx) => (await tx.get("r1"))?.text);
    await first;
    expect(await second).toBe("first");
  });

  test("one that failed does not stop the next", async () => {
    const { store } = setup();
    await expect(
      store.transaction(async () => Promise.reject(new Error("no"))),
    ).rejects.toThrow("no");
    expect(await store.transaction(async () => "fine")).toBe("fine");
  });
});

describe("pin stamps", () => {
  test("the history's clock learns every stamp that is saved, so a pin made after beats them", async () => {
    const { history, store } = setup();
    const id = history.copy("pin me later");
    // a Mac whose clock is a day ahead pinned something
    const ahead = stamp(1_000_000_000_000 + 86_400_000);
    await store.transaction((tx) =>
      tx.put({
        ...record("far", "far ahead"),
        pinned: { at: 5, stamp: ahead },
      }),
    );
    expect(history.observed).toContain(ahead);
    history.pin(id, true);
    expect(history.rows.get(id)!.pinnedStamp! > ahead).toBe(true);
  });

  test("the latest stamp is the largest stored", async () => {
    const { history, store } = setup();
    expect(await store.latestStamp()).toBeNull();
    const id = history.copy("one");
    history.pin(id, true);
    history.pin(id, false);
    expect(await store.latestStamp()).toBe(history.rows.get(id)!.pinnedStamp!);
  });
});

test("trimming applies the history's limits", async () => {
  const { history, store } = setup();
  await store.trimHistory();
  expect(history.trims).toBe(1);
});

// --- the real engine on the phone's store, against a Mac-like device

function waitFor(pair: MemoryPair, engines: SyncEngine[]): Promise<void> {
  return (async () => {
    let quiet = 0;
    for (let round = 0; round < 3000 && quiet < 4; round++) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const busy = pair.pending() > 0 || engines.some((e) => !e.isIdle());
      quiet = busy ? 0 : quiet + 1;
    }
    if (quiet < 4) throw new Error("The network never went quiet");
  })();
}

/** The phone as the sync page runs it: an engine on the database's store, told
 *  of every change to the history, as the store's listeners tell it */
class Phone {
  readonly history: FakeHistory;
  engine!: SyncEngine;
  itemsChanged = 0;
  private readonly network: TestNetwork;

  constructor(network: TestNetwork, history: FakeHistory) {
    this.network = network;
    this.history = history;
    history.listeners.add(() => this.engine.localChanged());
    this.start();
  }

  /** The service and the page start again: nothing is kept but the database */
  start(): void {
    const opened = openSyncStore(this.history);
    this.engine = new SyncEngine({
      deviceId: opened.deviceId,
      name: "Pixel",
      platform: "android",
      vaultKey: this.network.vaultKey,
      store: opened.store,
      scheduler: this.network.scheduler,
      now: this.network.now,
      onItemsChanged: () => {
        this.itemsChanged += 1;
      },
      onError: (error) => this.network.errors.push(error),
    });
  }
}

async function meet(
  network: TestNetwork,
  phoneDevice: Phone,
  macEngine: SyncEngine,
): Promise<{ pair: MemoryPair; settle: () => Promise<void> }> {
  const pair = memoryChannelPair();
  void macEngine.attach(pair.initiator);
  void phoneDevice.engine.attach(pair.responder);
  const settle = () => waitFor(pair, [macEngine, phoneDevice.engine]);
  await settle();
  return { pair, settle };
}

/** `skew`: how far behind the other devices the phone's clock is */
function engineSetup(skew = 0) {
  const network = new TestNetwork();
  const history = new FakeHistory(phone, () => network.now() - skew);
  const device = new Phone(network, history);
  const macDevice = network.add("a");
  return { network, history, device, macDevice };
}

const macTexts = (device: { store: { liveTexts(): string[] } }) =>
  device.store.liveTexts().sort();
const phoneTexts = (history: FakeHistory) => history.liveTexts().sort();

describe("the engine on the phone's database", () => {
  test("history that each side had before they met arrives on the other", async () => {
    const { network, history, device, macDevice } = engineSetup();
    macDevice.copy("from the mac, first");
    macDevice.copy("from the mac, second");
    history.copy("from the phone");
    const { pair } = await meet(network, device, macDevice.engine);
    expect(phoneTexts(history)).toEqual([
      "from the mac, first",
      "from the mac, second",
      "from the phone",
    ]);
    expect(macTexts(macDevice)).toEqual(phoneTexts(history));
    expect(network.errors).toEqual([]);
    pair.initiator.close("done");
    network.stop();
    device.engine.stop();
  });

  test("a copy, a pin, an unpin and a delete go both ways, and the app's list is told of what arrives", async () => {
    const { network, history, device, macDevice } = engineSetup();
    const { settle } = await meet(network, device, macDevice.engine);
    let told = 0;
    history.listeners.add(() => (told += 1));

    // phone → mac
    const onPhone = history.copy("copied on the phone");
    await settle();
    expect(macTexts(macDevice)).toEqual(["copied on the phone"]);
    history.pin(onPhone, true);
    await settle();
    expect(
      macDevice.store.snapshot().find((r) => r.id === onPhone)?.pinned?.at ?? 0,
    ).toBeGreaterThan(0);
    macDevice.pin(onPhone, false);
    await settle();
    expect(history.rows.get(onPhone)!.pinnedAt).toBeNull();
    // the unpin is stamped, so it beats the pin it undoes on both sides
    expect(history.rows.get(onPhone)!.pinnedStamp).toBe(
      macDevice.store.snapshot().find((r) => r.id === onPhone)!.pinned!.stamp,
    );

    // mac → phone
    const onMac = macDevice.copy("copied on the mac");
    await settle();
    expect(phoneTexts(history)).toEqual([
      "copied on the mac",
      "copied on the phone",
    ]);
    expect(told).toBeGreaterThan(0);
    macDevice.pin(onMac, true);
    await settle();
    expect(history.rows.get(onMac)!.pinnedAt).not.toBeNull();

    // deletes
    history.remove(onPhone);
    await settle();
    expect(macTexts(macDevice)).toEqual(["copied on the mac"]);
    macDevice.remove(onMac);
    await settle();
    expect(phoneTexts(history)).toEqual([]);
    expect(history.rows.get(onMac)).toMatchObject({
      value: null,
      deletedAt: expect.any(Number),
    });
    expect(network.errors).toEqual([]);
    network.stop();
    device.engine.stop();
  });

  test("a pin made on the phone after a Mac's wins, whatever the phone's clock says", async () => {
    // the phone's clock is two minutes slow
    const { network, history, device, macDevice } = engineSetup(120_000);
    const id = macDevice.copy("pinned by a mac");
    const { settle } = await meet(network, device, macDevice.engine);
    macDevice.pin(id, true);
    await settle();
    const macStamp = history.rows.get(id)!.pinnedStamp!;
    history.pin(id, false);
    await settle();
    expect(history.rows.get(id)!.pinnedStamp! > macStamp).toBe(true);
    expect(
      macDevice.store.snapshot().find((r) => r.id === id)?.pinned?.at,
    ).toBeNull();
    network.stop();
    device.engine.stop();
  });

  test("the same text copied on both devices ends as one item", async () => {
    const { network, history, device, macDevice } = engineSetup();
    const { settle } = await meet(network, device, macDevice.engine);
    macDevice.copy("both of us copied this");
    history.copy("both of us copied this");
    await settle();
    expect(phoneTexts(history)).toEqual(["both of us copied this"]);
    expect(macTexts(macDevice)).toEqual(["both of us copied this"]);
    expect(network.errors).toEqual([]);
    network.stop();
    device.engine.stop();
  });

  test("a text with a secret is stored with the secret found", async () => {
    const { network, history, device, macDevice } = engineSetup();
    macDevice.allowSecrets(true);
    const { settle } = await meet(network, device, macDevice.engine);
    macDevice.copy(secretText, { secret: true });
    await settle();
    const stored = [...history.rows.values()].find(
      (row) => row.value === secretText,
    )!;
    const [span] = JSON.parse(stored.secrets!) as {
      start: number;
      end: number;
    }[];
    expect(secretText.slice(span!.start, span!.end)).toBe("pa55");
    expect(stored.detectorVersion).toBe(detectionVersion);
    network.stop();
    device.engine.stop();
  });

  test("a secret copied on the phone stays on it, even when the capture did not look for it", async () => {
    const { network, history, device, macDevice } = engineSetup();
    const { settle } = await meet(network, device, macDevice.engine);
    history.copy(secretText);
    history.copy("harmless");
    await settle();
    expect(macTexts(macDevice)).toEqual(["harmless"]);
    network.stop();
    device.engine.stop();
  });

  test("after a restart nothing is lost, and sync goes on from where it was", async () => {
    const { network, history, device, macDevice } = engineSetup();
    macDevice.copy("before, from the mac");
    history.copy("before, from the phone");
    const first = await meet(network, device, macDevice.engine);
    const cursor = history.peers.get(mac)?.receivedSeq;
    expect(cursor).toBeGreaterThan(0);

    // the service stops, the app too: only the database is left
    device.engine.stop();
    first.pair.initiator.close("restarted");
    await first.settle();
    const putsBefore = history.putsSaved;
    macDevice.copy("while the phone was off");
    device.start();

    const second = await meet(network, device, macDevice.engine);
    expect(phoneTexts(history)).toEqual([
      "before, from the mac",
      "before, from the phone",
      "while the phone was off",
    ]);
    // only the new one came: it went on from the saved cursor, not from zero
    expect(history.putsSaved - putsBefore).toBe(1);
    expect(history.peers.get(mac)?.receivedSeq).toBeGreaterThan(cursor!);
    expect(macTexts(macDevice)).toEqual(phoneTexts(history));
    expect(network.errors).toEqual([]);
    second.pair.initiator.close("done");
    network.stop();
    device.engine.stop();
  });
});
