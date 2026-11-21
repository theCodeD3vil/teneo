import { describe, expect, test } from "bun:test";

import { type InboxEvent, readEvent, takeAll } from "./inbox";

describe("readEvent", () => {
  test("reads what PageInbox.java writes", () => {
    // PageInboxTest.java writes these same strings
    expect(readEvent("o3 110.0.2.2:51820")).toEqual({
      kind: "opened",
      connection: 3,
      initiator: true,
      address: "10.0.2.2:51820",
    });
    expect(readEvent("o4 0192.168.1.20")).toEqual({
      kind: "opened",
      connection: 4,
      initiator: false,
      address: "192.168.1.20",
    });
    expect(readEvent('m12 {"t":"ping"} and spaces')).toEqual({
      kind: "message",
      connection: 12,
      message: '{"t":"ping"} and spaces',
    });
    expect(readEvent("c5 ")).toEqual({
      kind: "closed",
      connection: 5,
      reason: "",
    });
    expect(readEvent("c5 the other device stopped")).toEqual({
      kind: "closed",
      connection: 5,
      reason: "the other device stopped",
    });
  });

  test("a message is passed on whole, however long", () => {
    const big = "A/+=".repeat(90_000);
    expect(readEvent(`m7 ${big}`)).toEqual({
      kind: "message",
      connection: 7,
      message: big,
    });
  });

  test("anything else is nothing", () => {
    for (const text of ["", "m", "m ", "m1", "x1 a", "mA b", "m-1 a", "o1 x"]) {
      expect(readEvent(text)).toBeNull();
    }
  });
});

describe("takeAll", () => {
  const queue =
    (...events: string[]) =>
    () =>
      events.shift() ?? null;

  test("hands every event on in order, until there are none", () => {
    const seen: InboxEvent["kind"][] = [];
    takeAll(
      queue("o1 1a", "m1 x", "c1 "),
      (event) => seen.push(event.kind),
      () => {},
    );
    expect(seen).toEqual(["opened", "message", "closed"]);
  });

  test("goes on past one that fails or can't be read, so none is left behind", () => {
    const seen: string[] = [];
    const errors: unknown[] = [];
    const events = ["m1 first", "junk", "m1 boom", "m1 last"];
    let asked = 0;
    takeAll(
      () => {
        asked += 1;
        return events.shift() ?? null;
      },
      (event) => {
        if (event.kind !== "message") return;
        if (event.message === "boom") throw new Error("boom");
        seen.push(event.message);
      },
      (error) => errors.push(error),
    );
    expect(seen).toEqual(["first", "last"]);
    expect(errors).toHaveLength(2);
    // it asked once more and found the inbox empty
    expect(asked).toBe(5);
  });

  test("a bridge that answers undefined for none ends it too", () => {
    let calls = 0;
    takeAll(
      () => (calls++ === 0 ? "m1 a" : undefined),
      () => {},
      () => {},
    );
    expect(calls).toBe(2);
  });
});
