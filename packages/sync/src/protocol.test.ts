import { expect, test } from "bun:test";

import { iconLimits, parseFrame } from "./protocol";

const state = {
  t: "state",
  epoch: "e1",
  name: "Pixel 9",
  platform: "android",
  cursor: { epoch: null, seq: 0 },
};
const parse = (frame: unknown) => parseFrame(JSON.stringify(frame));

test("a state frame from the first release is read as it always was", () => {
  expect(parse(state)).toEqual(state as never);
});

test("a state frame's maker and caps are read, and a bad one is left out", () => {
  expect(parse({ ...state, maker: "google", caps: ["app-icons"] })).toEqual({
    ...state,
    maker: "google",
    caps: ["app-icons"],
  } as never);
  // malformed extras never cost the device its connection
  expect(
    parse({ ...state, maker: 7, caps: ["ok", 3, "", "x".repeat(40)] }),
  ).toEqual({ ...state, caps: ["ok"] } as never);
  expect(parse({ ...state, maker: "", caps: "app-icons" })).toEqual(
    state as never,
  );
  // what a newer Teneo adds is dropped
  expect(parse({ ...state, somethingNew: true })).toEqual(state as never);
});

test("an icons-want frame holds a few app names", () => {
  expect(parse({ t: "icons-want", names: ["Safari", "Notes"] })).toEqual({
    t: "icons-want",
    names: ["Safari", "Notes"],
  });
  expect(parse({ t: "icons-want", names: [] })).toEqual({
    t: "icons-want",
    names: [],
  });
  expect(parse({ t: "icons-want", names: "Safari" })).toBeNull();
  expect(parse({ t: "icons-want", names: [""] })).toBeNull();
  expect(parse({ t: "icons-want", names: ["x".repeat(257)] })).toBeNull();
  expect(
    parse({
      t: "icons-want",
      names: Array.from({ length: iconLimits.count + 1 }, () => "A"),
    }),
  ).toBeNull();
});

test("an icons frame holds a few small icons", () => {
  const icons = [{ name: "Safari", png: "iVBORw0KGgo=" }];
  expect(parse({ t: "icons", icons })).toEqual({ t: "icons", icons });
  // unknown fields of an icon are dropped
  expect(parse({ t: "icons", icons: [{ ...icons[0], extra: 1 }] })).toEqual({
    t: "icons",
    icons,
  });
  expect(parse({ t: "icons", icons: [{ name: "Safari" }] })).toBeNull();
  expect(parse({ t: "icons", icons: [null] })).toBeNull();
  expect(
    parse({
      t: "icons",
      icons: [{ name: "Safari", png: "A".repeat(iconLimits.bytes * 2) }],
    }),
  ).toBeNull();
  expect(
    parse({
      t: "icons",
      icons: Array.from({ length: iconLimits.count + 1 }, () => icons[0]),
    }),
  ).toBeNull();
});

test("a frame of a kind this version doesn't know is refused", () => {
  expect(parse({ t: "icons-offer", names: [] })).toBeNull();
});
