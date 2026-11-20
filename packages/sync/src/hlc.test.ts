import { expect, test } from "bun:test";

import { Hlc, isFutureStamp, isStamp, maxClockSkewMs } from "./hlc";

const a = "a".repeat(32);
const b = "b".repeat(32);

test("stamps keep rising, even when the clock stands still or goes back", () => {
  let time = 1000;
  const clock = new Hlc(a, () => time);
  const stamps = [clock.next(), clock.next()];
  time = 500;
  stamps.push(clock.next());
  time = 5000;
  stamps.push(clock.next());
  expect(stamps.every(isStamp)).toBe(true);
  expect([...stamps].sort()).toEqual(stamps);
  expect(new Set(stamps).size).toBe(4);
});

test("after seeing a stamp from the future, the next one is larger", () => {
  const behind = new Hlc(a, () => 1000);
  const ahead = new Hlc(b, () => 9_000_000);
  const remote = ahead.next();
  behind.observe(remote);
  expect(behind.next() > remote).toBe(true);
  behind.observe(remote); // seeing it again changes nothing
  expect(isStamp(behind.next())).toBe(true);
});

test("two devices never make the same stamp", () => {
  const x = new Hlc(a, () => 1000);
  const y = new Hlc(b, () => 1000);
  const all = new Set([x.next(), y.next(), x.next(), y.next()]);
  expect(all.size).toBe(4);
});

test("a counter that runs out moves the time on instead", () => {
  const clock = new Hlc(a, () => 1000);
  let last = clock.next();
  for (let i = 0; i < 70_000; i++) {
    const next = clock.next();
    expect(next > last).toBe(true);
    last = next;
  }
});

test("only well-formed stamps and ids are accepted", () => {
  expect(isStamp("nope")).toBe(false);
  expect(isStamp(5)).toBe(false);
  expect(() => new Hlc("short")).toThrow();
  new Hlc(a).observe("garbage"); // ignored, no throw
});

test("a stamp from days ahead can't poison the clock", () => {
  const now = 1_763_000_000_000;
  const clock = new Hlc(a, () => now);
  // what a rogue peer sends: the largest stamp there is
  clock.observe(`ffffffffffff-ffff-${b}`);
  clock.observe(
    `${(now + maxClockSkewMs + 1).toString(16).padStart(12, "0")}-0000-${b}`,
  );
  const stamp = clock.next();
  expect(isStamp(stamp)).toBe(true);
  expect(parseInt(stamp.slice(0, 12), 16)).toBe(now);
  // a peer a few hours ahead is still followed
  const hoursAhead = `${(now + 3_600_000).toString(16).padStart(12, "0")}-0005-${b}`;
  clock.observe(hoursAhead);
  expect(clock.next() > hoursAhead).toBe(true);
  expect(isFutureStamp(`ffffffffffff-ffff-${b}`, now)).toBe(true);
  expect(isFutureStamp(hoursAhead, now)).toBe(false);
});

test("stamps never grow a thirteenth digit, even at the top", () => {
  const clock = new Hlc(a, () => 0xffff_ffff_ffff);
  for (let i = 0; i < 70_000; i++) expect(isStamp(clock.next())).toBe(true);
  expect(clock.next()).toBe(`ffffffffffff-ffff-${a}`);
});
