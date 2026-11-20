import { expect, test } from "bun:test";

import { type MemoryPairOptions, memoryChannelPair } from "./channel";
import { type Bytes, deriveVaultKeys, randomBytes } from "./crypto";
import type { ChangesFrame, Frame, StateFrame } from "./protocol";
import { type Scheduler, Session, SyncError } from "./session";
import { ManualScheduler } from "./testing";

const idA = "a".repeat(32);
const idB = "b".repeat(32);

const state: StateFrame = {
  t: "state",
  epoch: "e1",
  name: "Mac",
  platform: "mac",
  cursor: { epoch: null, seq: 0 },
};
const changes = (upTo: number): ChangesFrame => ({
  t: "changes",
  epoch: "e1",
  items: [],
  upTo,
  more: false,
});

const wait = (ms = 1) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean): Promise<void> {
  for (let i = 0; i < 1000 && !condition(); i++) await wait();
  if (!condition()) throw new Error("Timed out waiting");
}

interface Setup {
  authA?: Bytes;
  authB?: Bytes;
  pair?: MemoryPairOptions;
  scheduler?: Scheduler;
  now?: () => number;
}

async function connect(setup: Setup = {}) {
  const shared = (await deriveVaultKeys(randomBytes(32))).authKey;
  const pair = memoryChannelPair(setup.pair);
  const open = (
    channel: typeof pair.initiator,
    deviceId: string,
    authKey: Bytes,
  ) =>
    Session.open(channel, {
      deviceId,
      authKey,
      scheduler: setup.scheduler,
      now: setup.now,
    });
  const [a, b] = await Promise.allSettled([
    open(pair.initiator, idA, setup.authA ?? shared),
    open(pair.responder, idB, setup.authB ?? shared),
  ]);
  return { pair, a, b };
}

const opened = (result: PromiseSettledResult<Session>): Session => {
  if (result.status === "rejected") throw result.reason;
  return result.value;
};

const isEncrypted = (message: string) => !message.startsWith("{");

/** Tells the frames a side sends from its sealed proof, which is sealed too
 *  but always comes first. */
function framesFrom(side: "initiator" | "responder") {
  let sealedSeen = 0;
  return (from: string, message: string) =>
    from === side && isEncrypted(message) && ++sealedSeen > 1;
}

test("two devices with the same key open a session and exchange frames", async () => {
  const { a, b } = await connect();
  const [sessionA, sessionB] = [opened(a), opened(b)];
  expect(sessionA.peerId).toBe(idB);
  expect(sessionB.peerId).toBe(idA);
  expect(sessionA.initiator).toBe(true);
  expect(sessionB.initiator).toBe(false);

  const atB: Frame[] = [];
  const atA: Frame[] = [];
  sessionB.onFrame((frame) => void atB.push(frame));
  sessionA.onFrame((frame) => void atA.push(frame));
  await sessionA.send(state);
  await sessionB.send(changes(7));
  await until(() => atB.length === 1 && atA.length === 1);
  expect(atB).toEqual([state]);
  expect(atA).toEqual([changes(7)]);
  sessionA.close();
});

test("a device with another key is refused, on both sides", async () => {
  const [authA, authB] = [
    (await deriveVaultKeys(randomBytes(32))).authKey,
    (await deriveVaultKeys(randomBytes(32))).authKey,
  ];
  const { a, b } = await connect({ authA, authB });
  for (const result of [a, b]) {
    expect(result.status).toBe("rejected");
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(SyncError);
    expect(((result as PromiseRejectedResult).reason as SyncError).code).toBe(
      "auth",
    );
  }
});

test("another protocol version is refused with a message to update", async () => {
  const { a, b } = await connect({
    pair: {
      intercept: (from, message) => [
        from === "responder" ? message.replace('"v":2', '"v":3') : message,
      ],
    },
  });
  expect(a.status).toBe("rejected");
  const error = (a as PromiseRejectedResult).reason as SyncError;
  expect(error.code).toBe("version");
  expect(error.message).toContain("Update Teneo on the other device");
  expect(b.status).toBe("rejected"); // the connection was closed under it
});

test("a message that is not a hello ends the connection", async () => {
  const pair = memoryChannelPair();
  pair.responder.onMessage(() => {});
  pair.responder.onClose(() => {});
  const opening = Session.open(pair.initiator, {
    deviceId: idA,
    authKey: randomBytes(32),
  });
  pair.responder.send("hello? is this thing on");
  await expect(opening).rejects.toMatchObject({ code: "protocol" });
});

test("a connection that never finishes the handshake is dropped", async () => {
  const pair = memoryChannelPair();
  pair.responder.onMessage(() => {}); // hears the hello, answers nothing
  let closedWith: string | undefined;
  pair.responder.onClose((reason) => (closedWith = reason));
  const opening = Session.open(pair.initiator, {
    deviceId: idA,
    authKey: randomBytes(32),
    handshakeMs: 30,
  });
  await expect(opening).rejects.toMatchObject({ code: "timeout" });
  await wait(5);
  expect(closedWith).toBe("timeout"); // and the other end is told
});

test("the handshake timer does not outlive a session that opened", async () => {
  const { a, b } = await connect(); // the default is 10 s: an open session must not keep it
  opened(a).close();
  opened(b).close();
  await wait(5); // bun would hang on the exit if a 10 s timer were left running
});

test("a device that meets itself closes the connection", async () => {
  const key = (await deriveVaultKeys(randomBytes(32))).authKey;
  const pair = memoryChannelPair();
  const results = await Promise.allSettled([
    Session.open(pair.initiator, { deviceId: idA, authKey: key }),
    Session.open(pair.responder, { deviceId: idA, authKey: key }),
  ]);
  expect((results[0] as PromiseRejectedResult).reason.code).toBe("protocol");
});

test("a frame delivered twice closes the session", async () => {
  const isFrame = framesFrom("initiator");
  let framesSeen = 0;
  const { a, b } = await connect({
    pair: {
      intercept: (from, message) =>
        isFrame(from, message) && ++framesSeen === 1
          ? [message, message]
          : [message],
    },
  });
  const [sessionA, sessionB] = [opened(a), opened(b)];
  const received: Frame[] = [];
  sessionB.onFrame((frame) => void received.push(frame));
  await sessionA.send(state);
  const ended = await sessionB.closed;
  expect(ended?.code).toBe("protocol");
  expect(ended?.message).toContain("repeated");
  expect(received).toEqual([state]); // the original got through, the copy did not
});

test("a frame changed on the way closes the session without being read", async () => {
  const isFrame = framesFrom("initiator");
  const { a, b } = await connect({
    pair: {
      intercept: (from, message) => [
        isFrame(from, message)
          ? message.slice(0, 8) +
            (message[8] === "A" ? "B" : "A") +
            message.slice(9)
          : message,
      ],
    },
  });
  const [sessionA, sessionB] = [opened(a), opened(b)];
  const received: Frame[] = [];
  sessionB.onFrame((frame) => void received.push(frame));
  await sessionA.send(state);
  expect((await sessionB.closed)?.code).toBe("protocol");
  expect(received).toEqual([]);
});

test("frames delivered out of order close the session", async () => {
  let held: string | null = null;
  let count = 0;
  const isFrame = framesFrom("initiator");
  const { a, b } = await connect({
    pair: {
      intercept: (from, message) => {
        if (!isFrame(from, message)) return [message];
        count += 1;
        if (count === 1) {
          held = message;
          return [];
        }
        return [message, held!];
      },
    },
  });
  const [sessionA, sessionB] = [opened(a), opened(b)];
  const received: Frame[] = [];
  sessionB.onFrame((frame) => void received.push(frame));
  await sessionA.send(changes(1));
  await sessionA.send(changes(2));
  expect((await sessionB.closed)?.code).toBe("protocol");
  expect(received).toEqual([]);
});

test("frames that arrive before the handler is set wait for it, in order", async () => {
  const { a, b } = await connect();
  const [sessionA, sessionB] = [opened(a), opened(b)];
  for (const n of [1, 2, 3]) await sessionA.send(changes(n));
  await wait(20);
  const received: number[] = [];
  sessionB.onFrame((frame) => void received.push((frame as ChangesFrame).upTo));
  await until(() => received.length === 3);
  expect(received).toEqual([1, 2, 3]);
});

// --- heartbeat

async function quiet(
  sessions: Session[],
  pending: () => number,
): Promise<void> {
  await wait(2);
  await until(
    () => pending() === 0 && sessions.every((session) => session.idle()),
  );
}

test("a silent device is dropped after 45 seconds, an answering one is not", async () => {
  let time = 0;
  const scheduler = new ManualScheduler();
  const { pair, a, b } = await connect({ scheduler, now: () => time });
  const [sessionA, sessionB] = [opened(a), opened(b)];
  let ended: SyncError | null | undefined;
  void sessionA.closed.then((error) => (ended = error));

  for (let step = 1; step <= 6; step++) {
    time = step * 15_000;
    scheduler.tick();
    await quiet([sessionA, sessionB], pair.pending);
  }
  expect(ended).toBeUndefined(); // 90 seconds, and still connected

  // the other device goes quiet: its replies no longer arrive
  pair.responder.send = () => {};
  const lastAnswer = time;
  for (let step = 1; step <= 4 && ended === undefined; step++) {
    time = lastAnswer + step * 15_000;
    scheduler.tick();
    await quiet([sessionA, sessionB], pair.pending);
  }
  await until(() => ended !== undefined);
  expect(ended?.code).toBe("timeout");
  expect(time - lastAnswer).toBe(60_000); // silent for more than 45 s, not before
});

test("a device on version 1 is told to update, and learns no device's id", async () => {
  const pair = memoryChannelPair();
  const heard: string[] = [];
  pair.responder.onMessage((message) => heard.push(message));
  pair.responder.onClose(() => {});
  const opening = Session.open(pair.initiator, {
    deviceId: idA,
    authKey: randomBytes(32),
  });
  await until(() => heard.length === 1);
  const hello = JSON.parse(heard[0]!);
  // what a version 1 device reads: a hello, of another version
  expect(hello).toMatchObject({ t: "hello", v: 2 });
  expect(hello.deviceId).toMatch(/^[0-9a-f]{32}$/);
  expect(hello.deviceId).not.toBe(idA);
  pair.responder.send(
    JSON.stringify({ t: "hello", v: 1, deviceId: idB, nonce: "0".repeat(32) }),
  );
  await expect(opening).rejects.toMatchObject({ code: "version" });
});

test("nothing either device sends in the clear names it", async () => {
  const sent: string[] = [];
  const { a, b } = await connect({
    pair: {
      intercept: (_from, message) => {
        sent.push(message);
        return [message];
      },
    },
  });
  opened(a);
  opened(b);
  const clear = sent.filter((message) => !isEncrypted(message)).join("\n");
  expect(clear).not.toContain(idA);
  expect(clear).not.toContain(idB);
  expect(opened(a).peerId).toBe(idB);
  expect(opened(b).peerId).toBe(idA);
});

test("two connections between the same devices never share keys", async () => {
  // the eph keys differ every time, so a recorded connection gives nothing
  // for another, nor (once they are gone) for whoever later has the vault key
  const key = (await deriveVaultKeys(randomBytes(32))).authKey;
  const firstFrames: string[] = [];
  for (let round = 0; round < 2; round++) {
    const isFrame = framesFrom("initiator");
    const pair = memoryChannelPair({
      intercept: (from, message) => {
        if (isFrame(from, message)) firstFrames.push(message);
        return [message];
      },
    });
    const [x, y] = await Promise.all([
      Session.open(pair.initiator, { deviceId: idA, authKey: key }),
      Session.open(pair.responder, { deviceId: idB, authKey: key }),
    ]);
    await x.send(state);
    x.close();
    y.close();
  }
  expect(firstFrames.length).toBe(2);
  expect(firstFrames[0]).not.toBe(firstFrames[1]);
});
