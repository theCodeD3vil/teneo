import { expect, test } from "bun:test";

import { shortTimeAgo } from "./ago";

const now = 1_700_000_000_000;
const ago = (milliseconds: number) => shortTimeAgo(now - milliseconds, now);
const [s, m, h, d] = [1000, 60_000, 3_600_000, 86_400_000];

test("a time is told in its largest whole unit, short", () => {
  expect(ago(1 * s)).toBe("1s ago");
  expect(ago(30 * s)).toBe("30s ago");
  expect(ago(59.9 * s)).toBe("59s ago");
  expect(ago(1 * m)).toBe("1min ago");
  expect(ago(3 * m)).toBe("3mins ago");
  expect(ago(59 * m + 59 * s)).toBe("59mins ago");
  expect(ago(1 * h)).toBe("1h ago");
  expect(ago(4 * h + 40 * m)).toBe("4h ago");
  expect(ago(23 * h)).toBe("23h ago");
  expect(ago(1 * d)).toBe("1d ago");
  expect(ago(3 * d)).toBe("3d ago");
  expect(ago(6 * d + 23 * h)).toBe("6d ago");
  expect(ago(7 * d)).toBe("1w ago");
  expect(ago(29 * d)).toBe("4w ago");
  expect(ago(30 * d)).toBe("1mo ago");
  expect(ago(364 * d)).toBe("12mo ago");
  expect(ago(365 * d)).toBe("1y ago");
  expect(ago(800 * d)).toBe("2y ago");
});

test("just now, and a time ahead of the clock, are now", () => {
  expect(ago(0)).toBe("now");
  expect(ago(999)).toBe("now");
  expect(ago(-5 * m)).toBe("now");
});
