import { expect, test } from "bun:test";

import { SocketChannel } from "./ws-channel";

function make() {
  const sent: string[] = [];
  const closed: Array<string | undefined> = [];
  const channel = new SocketChannel({
    initiator: true,
    remoteAddress: "10.0.0.2:47823",
    socket: {
      send: (message) => void sent.push(message),
      close: (reason) => void closed.push(reason),
    },
  });
  return { channel, sent, closed };
}

test("messages that arrive before the handler is set wait for it, in order", () => {
  const { channel } = make();
  channel.deliver("hello");
  channel.deliver("proof");
  const heard: string[] = [];
  channel.onMessage((message) => heard.push(message));
  expect(heard).toEqual(["hello", "proof"]);
  channel.deliver("frame");
  expect(heard).toEqual(["hello", "proof", "frame"]);
});

test("the close is told after the messages that came before it, once", () => {
  const { channel } = make();
  const events: string[] = [];
  channel.deliver("last words");
  channel.ended("timeout");
  channel.onMessage((message) => events.push(`message ${message}`));
  channel.onClose((reason) => events.push(`close ${reason}`));
  channel.ended("again");
  expect(events).toEqual(["message last words", "close timeout"]);
});

test("closing this side closes the socket and ends the channel", () => {
  const { channel, sent, closed } = make();
  const reasons: Array<string | undefined> = [];
  channel.onMessage(() => {});
  channel.onClose((reason) => reasons.push(reason));
  channel.close("auth");
  channel.close("again");
  expect(closed).toEqual(["auth"]);
  expect(reasons).toEqual(["auth"]);
  channel.send("too late");
  channel.deliver("too late too");
  expect(sent).toEqual([]);
});

test("an empty close reason is no reason, and the address is kept", () => {
  const { channel } = make();
  const reasons: Array<string | undefined> = [];
  channel.onMessage(() => {});
  channel.onClose((reason) => reasons.push(reason));
  channel.ended("");
  expect(reasons).toEqual([undefined]);
  expect(channel.remoteAddress).toBe("10.0.0.2:47823");
  expect(channel.initiator).toBe(true);
});

test("messages are sent through to the socket", () => {
  const { channel, sent } = make();
  channel.send("one");
  channel.send("two");
  expect(sent).toEqual(["one", "two"]);
});
