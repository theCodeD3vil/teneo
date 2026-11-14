import { expect, test } from "bun:test";

import {
  type ItemRecord,
  collapseSameText,
  isSameRecord,
  maxTextBytes,
  mergeRecords,
  parseRecord,
  utf8Length,
} from "./record";

const device = "a".repeat(32);
const stamp = (wall: number, counter = 0) =>
  `${wall.toString(16).padStart(12, "0")}-${counter.toString(16).padStart(4, "0")}-${device}`;

// A small seeded generator, so a failure can be repeated
function seeded(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Few distinct values, so ties and equal fields turn up often. A stamp always
// comes with the same `at`, as it does for real: one stamp is one pin.
const pins = [
  null,
  { at: null, stamp: stamp(1) },
  { at: 500, stamp: stamp(2) },
  { at: null, stamp: stamp(3) },
  { at: 700, stamp: stamp(3, 1) },
  { at: 900, stamp: stamp(4) },
];
const apps = [null, "Safari", "Notes", "Xcode"];

function randomVersion(random: () => number): ItemRecord {
  const pick = <T>(list: T[]): T => list[Math.floor(random() * list.length)]!;
  const deleted = random() < 0.3;
  return {
    id: "item-1",
    kind: "text",
    text: deleted ? null : "hello",
    createdAt: 1000,
    origin: device,
    dateCopied: 1000 + Math.floor(random() * 4),
    sourceApp: pick(apps),
    pinned: pick(pins),
    deletedAt: deleted ? 2000 + Math.floor(random() * 4) : null,
  };
}

test("merge is commutative, associative and idempotent", () => {
  const random = seeded(42);
  for (let i = 0; i < 3000; i++) {
    const [a, b, c] = [
      randomVersion(random),
      randomVersion(random),
      randomVersion(random),
    ];
    expect(mergeRecords(a, b)).toEqual(mergeRecords(b, a));
    expect(mergeRecords(mergeRecords(a, b), c)).toEqual(
      mergeRecords(a, mergeRecords(b, c)),
    );
    expect(mergeRecords(a, a)).toEqual(a);
    expect(mergeRecords(mergeRecords(a, b), b)).toEqual(mergeRecords(a, b));
  }
});

test("a merge never loses a delete, a later copy or a newer pin", () => {
  const random = seeded(7);
  for (let i = 0; i < 1000; i++) {
    const [a, b] = [randomVersion(random), randomVersion(random)];
    const merged = mergeRecords(a, b);
    if (a.deletedAt !== null || b.deletedAt !== null) {
      expect(merged.deletedAt).toBe(
        Math.min(...[a.deletedAt, b.deletedAt].filter((t) => t !== null)),
      );
      expect(merged.text).toBeNull();
    }
    expect(merged.dateCopied).toBe(Math.max(a.dateCopied, b.dateCopied));
    const newestStamp = [a.pinned?.stamp, b.pinned?.stamp]
      .filter(Boolean)
      .sort()
      .at(-1);
    expect(merged.pinned?.stamp).toBe(newestStamp);
  }
});

test("the later copy brings its own source app", () => {
  const a = {
    ...randomVersion(seeded(1)),
    deletedAt: null,
    text: "x",
    dateCopied: 10,
    sourceApp: "Safari",
  };
  const b = { ...a, dateCopied: 20, sourceApp: "Notes" };
  expect(mergeRecords(a, b).sourceApp).toBe("Notes");
  expect(mergeRecords(b, a).sourceApp).toBe("Notes");
});

test("isSameRecord tells a merge that changed nothing", () => {
  const random = seeded(3);
  const a = randomVersion(random);
  expect(isSameRecord(a, { ...a })).toBe(true);
  expect(isSameRecord(a, { ...a, dateCopied: a.dateCopied + 1 })).toBe(false);
});

test("the same text on two devices keeps the smaller id, with the later copy", () => {
  const base = {
    ...randomVersion(seeded(5)),
    deletedAt: null,
    text: "same",
    pinned: null,
  };
  const first = { ...base, id: "aaaa-1", dateCopied: 10, sourceApp: "Notes" };
  const second = { ...base, id: "bbbb-1", dateCopied: 20, sourceApp: "Safari" };
  for (const [x, y] of [
    [first, second],
    [second, first],
  ] as const) {
    const { kept, dropped } = collapseSameText(x, y, 99);
    expect(kept).toMatchObject({
      id: "aaaa-1",
      dateCopied: 20,
      sourceApp: "Safari",
      deletedAt: null,
    });
    expect(dropped).toMatchObject({ id: "bbbb-1", text: null, deletedAt: 99 });
  }
});

// --- validation

const valid = {
  id: "abc-1",
  kind: "text",
  text: "hello",
  createdAt: 1,
  origin: device,
  dateCopied: 2,
  sourceApp: null,
  pinned: null,
  deletedAt: null,
};

test("a valid record is accepted, and unknown fields are dropped", () => {
  expect(parseRecord(valid)).toEqual(valid);
  expect(parseRecord({ ...valid, extra: "x" })).toEqual(valid);
  const pinned = { at: 5, stamp: stamp(9) };
  expect(parseRecord({ ...valid, pinned })).toEqual({ ...valid, pinned });
});

test("a tombstone has no text, a live item has", () => {
  expect(parseRecord({ ...valid, text: null, deletedAt: 5 })).not.toBeNull();
  expect(
    parseRecord({ ...valid, text: "still here", deletedAt: 5 }),
  ).toBeNull();
  expect(parseRecord({ ...valid, text: null })).toBeNull();
});

test("malformed records are refused field by field", () => {
  const bad: unknown[] = [
    null,
    "text",
    [],
    { ...valid, id: "" },
    { ...valid, id: "a/b" },
    { ...valid, id: "x".repeat(65) },
    { ...valid, kind: "image" },
    { ...valid, createdAt: -1 },
    { ...valid, createdAt: 1.5 },
    { ...valid, dateCopied: "2" },
    { ...valid, dateCopied: Number.MAX_SAFE_INTEGER + 2 },
    { ...valid, origin: "not-a-device" },
    { ...valid, sourceApp: "" },
    { ...valid, sourceApp: 5 },
    { ...valid, sourceApp: "x".repeat(257) },
    { ...valid, pinned: "yes" },
    { ...valid, pinned: { at: 1, stamp: "nope" } },
    { ...valid, pinned: { at: -1, stamp: stamp(1) } },
    { ...valid, deletedAt: "now", text: null },
    { ...valid, text: 5 },
  ];
  for (const record of bad) expect(parseRecord(record)).toBeNull();
  const missing = { ...valid } as Record<string, unknown>;
  for (const field of Object.keys(valid)) {
    const without = { ...missing };
    delete without[field];
    expect(parseRecord(without)).toBeNull();
  }
});

test("text is limited to 1 MB, counted in bytes", () => {
  expect(
    parseRecord({ ...valid, text: "a".repeat(maxTextBytes) }),
  ).not.toBeNull();
  expect(
    parseRecord({ ...valid, text: "a".repeat(maxTextBytes + 1) }),
  ).toBeNull();
  // 3 bytes each: under the limit in characters, over it in bytes
  expect(
    parseRecord({ ...valid, text: "€".repeat(maxTextBytes / 3 + 1) }),
  ).toBeNull();
});

test("utf8Length matches the real encoding", () => {
  const encoder = new TextEncoder();
  const samples = [
    "",
    "plain",
    "héllo",
    "€uro",
    "日本語",
    "emoji 😀 and 👩‍👩‍👧",
    "\u0000\u007f\u0080߿ࠀ",
  ];
  for (const sample of samples)
    expect(utf8Length(sample)).toBe(encoder.encode(sample).length);
});
