import { expect, test } from "bun:test";

import { maxTextBytes } from "@teneo/sync";

import {
  type SyncRow,
  holdsSecret,
  pinStampFor,
  recordToColumns,
  rowToRecord,
} from "./records";

const device = "a".repeat(32);
const other = "b".repeat(32);

const row: SyncRow = {
  id: "0f3a-1",
  kind: "text",
  value: "hello",
  dateCopied: 2000,
  sourceAppName: "Notes",
  sourceAppBundleId: "com.apple.Notes",
  pinnedAt: null,
  pinnedStamp: null,
  deletedAt: null,
  createdAt: 1000,
  originDevice: other,
  secrets: null,
  encrypted: null,
};

test("a text row becomes the record of the item", () => {
  expect(rowToRecord(row, device)).toEqual({
    id: "0f3a-1",
    kind: "text",
    text: "hello",
    createdAt: 1000,
    origin: other,
    dateCopied: 2000,
    sourceApp: "Notes",
    pinned: null,
    deletedAt: null,
  });
});

test("a row from before sync takes its copy time and this device", () => {
  const record = rowToRecord(
    { ...row, createdAt: null, originDevice: null },
    device,
  );
  expect(record).toMatchObject({ createdAt: 2000, origin: device });
});

test("rows that are not text, or that a peer would refuse, are left out", () => {
  expect(rowToRecord({ ...row, kind: "image" }, device)).toBeNull();
  expect(rowToRecord({ ...row, id: "a/b" }, device)).toBeNull();
  expect(rowToRecord({ ...row, value: null }, device)).toBeNull();
  expect(
    rowToRecord({ ...row, value: "a".repeat(maxTextBytes + 1) }, device),
  ).toBeNull();
});

test("no source app is null, whether it is stored empty or missing", () => {
  expect(
    rowToRecord({ ...row, sourceAppName: "" }, device)?.sourceApp,
  ).toBeNull();
  expect(
    rowToRecord({ ...row, sourceAppName: null }, device)?.sourceApp,
  ).toBeNull();
});

test("a pin from before sync gets the same stamp every time", () => {
  const pinned = { ...row, pinnedAt: 5000 };
  const first = rowToRecord(pinned, device)?.pinned;
  expect(first).toEqual({ at: 5000, stamp: pinStampFor(5000, device) });
  expect(rowToRecord(pinned, device)?.pinned).toEqual(first!);
  expect(pinStampFor(5000, device)).toBe(`000000001388-0000-${device}`);
});

test("a pin made after sync keeps its own stamp, and so does an unpin", () => {
  const stamp = `0000000000ff-0003-${other}`;
  expect(
    rowToRecord({ ...row, pinnedAt: 5000, pinnedStamp: stamp }, device)?.pinned,
  ).toEqual({ at: 5000, stamp });
  expect(rowToRecord({ ...row, pinnedStamp: stamp }, device)?.pinned).toEqual({
    at: null,
    stamp,
  });
});

test("a deleted row is a tombstone, even when its text was kept", () => {
  const record = rowToRecord(
    { ...row, deletedAt: 3000, pinnedAt: 5000, value: "still here" },
    device,
  );
  expect(record).toMatchObject({ text: null, deletedAt: 3000 });
  expect(record?.pinned?.at).toBeNull(); // a deleted item is not pinned
});

test("an item holding a secret is told apart, encrypted or not", () => {
  expect(holdsSecret(row)).toBe(false);
  expect(holdsSecret({ ...row, secrets: "[]" })).toBe(true);
  expect(holdsSecret({ ...row, encrypted: 1 })).toBe(true);
});

test("a record sets its row, keeping the bundle id while the app stays", () => {
  const record = rowToRecord(row, device)!;
  expect(recordToColumns(record, row)).toEqual({
    value: "hello",
    dateCopied: 2000,
    sourceAppName: "Notes",
    sourceAppBundleId: "com.apple.Notes",
    pinnedAt: null,
    pinnedStamp: null,
    deletedAt: null,
  });
  expect(
    recordToColumns({ ...record, sourceApp: "Safari" }, row).sourceAppBundleId,
  ).toBeNull();
  expect(recordToColumns(record, null).sourceAppBundleId).toBeNull();
});

test("a tombstone clears the text and the pin time, and keeps the stamp", () => {
  const stamp = `0000000000ff-0003-${other}`;
  const columns = recordToColumns(
    {
      ...rowToRecord(row, device)!,
      text: null,
      deletedAt: 3000,
      pinned: { at: null, stamp },
    },
    row,
  );
  expect(columns).toMatchObject({
    value: null,
    pinnedAt: null,
    pinnedStamp: stamp,
    deletedAt: 3000,
  });
});
