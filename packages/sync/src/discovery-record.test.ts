import { expect, test } from "bun:test";

import { makeDiscoveryRecord, readDiscoveryRecord } from "./discovery-record";

const key = "ab".repeat(32);
const deviceId = "0123456789abcdef0123456789abcdef";

// The same vector is in NsdDiscoveryRecordTest.java (and was checked with
// Python's hmac): the phone and the Mac announce alike
test("matches the shared test vector", async () => {
  expect(await makeDiscoveryRecord(key, deviceId, "00112233aabbccdd")).toEqual({
    instance: "teneo-00112233aabbccdd",
    txt: {
      s: "00112233aabbccdd",
      vt: "ee39c34e236fbdb3",
      dev: "775e94fc09aaa329a38270332cce2cc5",
    },
  });
});

test("a device of the vault reads the id back; nobody else can", async () => {
  const record = await makeDiscoveryRecord(key, deviceId);
  expect(await readDiscoveryRecord(key, record.txt)).toBe(deviceId);
  expect(await readDiscoveryRecord("cd".repeat(32), record.txt)).toBeNull();
  expect(
    await readDiscoveryRecord(key, { ...record.txt, vt: "0".repeat(16) }),
  ).toBeNull();
  // version 1's announcement, and nonsense
  expect(
    await readDiscoveryRecord(key, { vt: "a".repeat(16), dev: deviceId }),
  ).toBeNull();
  expect(await readDiscoveryRecord(key, {})).toBeNull();
});

test("nothing in it stays the same from one network to the next", async () => {
  const [first, second] = await Promise.all([
    makeDiscoveryRecord(key, deviceId),
    makeDiscoveryRecord(key, deviceId),
  ]);
  expect(first.instance).not.toBe(second.instance);
  expect(first.txt.vt).not.toBe(second.txt.vt);
  expect(first.txt.dev).not.toBe(second.txt.dev);
  const text = JSON.stringify(first);
  expect(text).not.toContain(deviceId);
  expect(text).not.toContain(deviceId.slice(0, 12));
});
