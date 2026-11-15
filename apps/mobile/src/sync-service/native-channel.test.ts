import { expect, test } from "bun:test";

import { NativeChannel } from "./native-channel";

function channel(initiator = false) {
  const sent: string[] = [];
  const closes: (string | undefined)[] = [];
  const native = new NativeChannel({
    initiator,
    remoteAddress: "10.0.0.2",
    connection: {
      send: (message) => sent.push(message),
      close: (reason) => closes.push(reason),
    },
  });
  return { native, sent, closes };
}

test("it says which side opened it and where the other side is", () => {
  const { native } = channel(true);
  expect(native.initiator).toBe(true);
  expect(native.remoteAddress).toBe("10.0.0.2");
});

test("messages that arrive before the handler wait for it, in order", () => {
  const { native } = channel();
  native.deliver("hello");
  native.deliver("proof");
  const got: string[] = [];
  native.onMessage((message) => got.push(message));
  native.deliver("state");
  expect(got).toEqual(["hello", "proof", "state"]);
});

test("the close comes after every message that arrived before it", () => {
  const { native } = channel();
  const events: string[] = [];
  native.deliver("one");
  native.deliver("two");
  native.ended("auth");
  native.onClose((reason) => events.push(`closed ${reason}`));
  expect(events).toEqual([]); // the messages have no handler yet: the close waits
  native.onMessage((message) => events.push(message));
  expect(events).toEqual(["one", "two", "closed auth"]);
});

test("it is told of the end once, however often the bridge says so", () => {
  const { native } = channel();
  const reasons: (string | undefined)[] = [];
  native.onMessage(() => {});
  native.onClose((reason) => reasons.push(reason));
  native.ended("first");
  native.ended("second");
  expect(reasons).toEqual(["first"]);
});

test("an end with no reason is told as no reason", () => {
  const { native } = channel();
  let told: string | undefined = "unset";
  native.onClose((reason) => (told = reason));
  native.ended("");
  expect(told).toBeUndefined();
});

test("nothing arrives or goes after the end", () => {
  const { native, sent } = channel();
  const got: string[] = [];
  native.onMessage((message) => got.push(message));
  native.ended();
  native.deliver("late");
  native.send("too late");
  expect(got).toEqual([]);
  expect(sent).toEqual([]);
});

test("send goes to the connection", () => {
  const { native, sent } = channel();
  native.send("a");
  native.send("b");
  expect(sent).toEqual(["a", "b"]);
});

test("closing tells the connection with the reason, and ends it here at once", () => {
  const { native, closes } = channel();
  let told: string | undefined = "unset";
  native.onClose((reason) => (told = reason));
  native.close("protocol");
  expect(closes).toEqual(["protocol"]);
  expect(told).toBe("protocol");
  native.close("again"); // nothing more to say
  expect(closes).toEqual(["protocol"]);
});

test("a close from the other side is not sent back to it", () => {
  const { native, closes } = channel();
  native.onClose(() => {});
  native.ended("done");
  native.close();
  expect(closes).toEqual([]);
});
