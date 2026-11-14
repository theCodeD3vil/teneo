// Storage tests that need the real runtime: they use `tjs:sqlite`, which bun
// doesn't have. Run with `bun run test:runtime` from apps/desktop. They only
// ever touch a temp folder: the app, its store and its Keychain are stubs.
/* oxlint-disable no-console -- a test run reports on the console */
import {
  type ItemRecord,
  SyncEngine,
  isSameRecord,
  memoryChannelPair,
} from "@teneo/sync";
import { TestNetwork } from "@teneo/sync/testing";
import { Database } from "tjs:sqlite";

import {
  countClipboardItemsToDelete,
  deleteClipboardItems,
  getSyncIdentity,
  initializeDatabase,
  listClipboardItemSizes,
  listClipboardItems,
  purgeOldTombstones,
  restampSecretItems,
  saveClipboardItem,
  setClipboardItemPinned,
  softDeleteClipboardItem,
} from "../database";
import { clearClipboardHistory } from "../history-limits";
import { getSettings, loadSettings, updateSettings } from "../settings";
import { all, run } from "../sqlite";
import type { ClipboardItemToSave } from "../types/clipboard";
import { pinStampFor, tombstoneLifetime } from "./records";
import { check, finish, rejects, same, test } from "./runtime-test";
import { backfillSyncColumns, syncEpoch, syncHead } from "./schema";
import { SqliteSyncStore } from "./sync-store";

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function until(condition: () => boolean, what: string): Promise<void> {
  let quiet = 0;
  for (let i = 0; i < 3000 && quiet < 5; i++) {
    await delay(0);
    quiet = condition() ? quiet + 1 : 0;
  }
  check(quiet >= 5, `timed out: ${what}`);
}

// --- a stub app on a temp folder

const folder = await tjs.makeTempDir(`${tjs.tmpDir}/teneo-sync-XXXXXX`);
const dataFolder = `${folder}/data`;
await tjs.makeDir(dataFolder, { recursive: true });
await tjs.makeDir(`${folder}/cache`, { recursive: true });

const stored = new Map<string, unknown>();
const secrets = new Map<string, string>();
const app = {
  paths: async () => ({ data: dataFolder, cache: `${folder}/cache` }),
  store: {
    get: async (key: string) => stored.get(key) ?? null,
    set: async (key: string, value: unknown) => {
      stored.set(key, value);
      return true;
    },
  },
  secrets: {
    get: async (key: string) => secrets.get(key) ?? null,
    set: async (key: string, value: string) => {
      secrets.set(key, value);
      return true;
    },
    delete: async (key: string) => secrets.delete(key),
  },
  push: () => {},
} as unknown as TinyApp;

// --- helpers

interface Row {
  id: string;
  kind: string;
  value: string | null;
  path: string | null;
  dateCopied: number;
  sourceAppName: string | null;
  sourceAppBundleId: string | null;
  pinnedAt: number | null;
  pinnedStamp: string | null;
  deletedAt: number | null;
  encrypted: number | null;
  secrets: string | null;
  linkUrl: string | null;
  syncSeq: number | null;
  createdAt: number | null;
  originDevice: string | null;
}

const day = 24 * 60 * 60 * 1000;
const peerId = "b".repeat(32);
const secretText = "postgres://user:pa55@db.example.com/app";

const textItem = (
  text: string,
  sourceApp: ClipboardItemToSave["sourceApp"] = null,
): ClipboardItemToSave => ({
  kind: "text",
  changeCount: 0,
  text,
  html: null,
  paths: [],
  image: null,
  imageSize: null,
  color: null,
  concealed: false,
  sourceApp,
  sourceURL: null,
});

const colorItem = (color: string): ClipboardItemToSave => ({
  ...textItem(""),
  kind: "color",
  text: null,
  color,
});

async function imageItem(name: string): Promise<ClipboardItemToSave> {
  await tjs.makeDir(`${dataFolder}/images`, { recursive: true });
  const image = `${dataFolder}/images/${name}.png`;
  await tjs.writeFile(image, new Uint8Array([1, 2, 3]));
  return {
    ...textItem(""),
    kind: "image",
    text: null,
    image,
    imageSize: { width: 1, height: 1 },
  };
}

const fileExists = (path: string) =>
  tjs.stat(path).then(
    () => true,
    () => false,
  );

// the settings and the database are set up as the app does at start
await loadSettings(app);

// An older Teneo's database: no sync columns, and rows it had saved. It is
// made before the first initializeDatabase, which has to migrate it.
const oldDatabase = new Database(`${dataFolder}/teneo.sqlite`);
oldDatabase.exec(`
  CREATE TABLE "CLIPBOARD_ITEMS" (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('text', 'image', 'files', 'color')),
    imageSize TEXT, path TEXT, value TEXT, dateCopied INTEGER NOT NULL,
    sourceAppName TEXT, sourceAppBundleId TEXT, deletedAt INTEGER,
    pinnedAt INTEGER, pasteAsFile INTEGER, encrypted INTEGER,
    secrets TEXT, linkUrl TEXT, linkHost TEXT, detectorVersion INTEGER
  );
  INSERT INTO "CLIPBOARD_ITEMS" (id, kind, value, dateCopied, sourceAppName, sourceAppBundleId)
    VALUES ('old-1', 'text', 'alpha', 1000, 'Notes', 'com.apple.Notes');
  INSERT INTO "CLIPBOARD_ITEMS" (id, kind, value, dateCopied, pinnedAt)
    VALUES ('old-2', 'text', 'beta', 2000, 5000);
  INSERT INTO "CLIPBOARD_ITEMS" (id, kind, value, dateCopied, deletedAt)
    VALUES ('old-3', 'text', 'gamma', 3000, 3500);
  INSERT INTO "CLIPBOARD_ITEMS" (id, kind, path, dateCopied)
    VALUES ('old-4', 'image', 'images/old.png', 4000);
`);
oldDatabase.close();

const database = await initializeDatabase(app);
const { deviceId, clock } = getSyncIdentity();
const store = new SqliteSyncStore(app);

const rowOf = (id: string): Row => {
  const [row] = all<Row>(
    database,
    `SELECT * FROM "CLIPBOARD_ITEMS" WHERE id = ?`,
    id,
  );
  check(row, `no row ${id}`);
  return row;
};
const allRows = () =>
  all<Row>(database, `SELECT * FROM "CLIPBOARD_ITEMS" ORDER BY syncSeq`);
const reset = () => run(database, `DELETE FROM "CLIPBOARD_ITEMS"`);
const head = () => syncHead(database);

const record = (id: string, text: string | null, extra = {}): ItemRecord => ({
  id,
  kind: "text",
  text,
  createdAt: 1000,
  origin: peerId,
  dateCopied: 2000,
  sourceApp: null,
  pinned: null,
  deletedAt: null,
  ...extra,
});
const stampAt = (wall: number, counter = 0) =>
  `${wall.toString(16).padStart(12, "0")}-${counter.toString(16).padStart(4, "0")}-${peerId}`;

// --- tests

await test("a database from an older Teneo is migrated and its rows backfilled", async () => {
  const columns = all<{ name: string }>(
    database,
    `PRAGMA table_info("CLIPBOARD_ITEMS")`,
  ).map((c) => c.name);
  for (const name of ["syncSeq", "pinnedStamp", "originDevice", "createdAt"]) {
    check(columns.includes(name), `column ${name} missing`);
  }
  const rows = allRows();
  same(rows.length, 4, "no row lost");
  const seqs = rows.map((r) => r.syncSeq);
  check(
    seqs.every((s) => s !== null),
    "every row has a syncSeq",
  );
  same(new Set(seqs).size, 4, "syncSeq values are unique");
  same(
    rows.map((r) => r.id),
    ["old-1", "old-2", "old-3", "old-4"],
    "in the order they were copied",
  );
  same(
    head(),
    Math.max(...(seqs as number[])),
    "the counter is at the last one",
  );
  check(
    rows.every(
      (r) => r.createdAt === r.dateCopied && r.originDevice === deviceId,
    ),
    "createdAt and originDevice filled in",
  );
  same(rowOf("old-2").pinnedStamp, pinStampFor(5000, deviceId), "pin stamp");
  check(
    /^[0-9a-f]{16}$/.test(syncEpoch(database)),
    "the epoch is 16 hex digits",
  );
  check(/^[0-9a-f]{32}$/.test(deviceId), "the device id is 32 hex digits");
});

await test("backfilling again changes nothing; an older Teneo's rows are picked up", async () => {
  const before = allRows().map((r) => [r.id, r.syncSeq]);
  const headBefore = head();
  backfillSyncColumns(database, deviceId);
  same(
    allRows().map((r) => [r.id, r.syncSeq]),
    before,
    "rows untouched",
  );
  same(head(), headBefore, "counter untouched");

  // an older Teneo writes with the columns it knows
  run(
    database,
    `INSERT INTO "CLIPBOARD_ITEMS" (id, kind, value, dateCopied) VALUES ('old-5', 'text', 'epsilon', 6000)`,
  );
  run(
    database,
    `UPDATE "CLIPBOARD_ITEMS" SET pinnedAt = 7000 WHERE id = 'old-1'`,
  );
  backfillSyncColumns(database, deviceId);
  check(rowOf("old-5").syncSeq! > headBefore, "the new row got a new number");
  check(
    rowOf("old-1").syncSeq! > headBefore,
    "the newly pinned row is sent again",
  );
  same(
    rowOf("old-1").pinnedStamp,
    pinStampFor(7000, deviceId),
    "its pin stamp",
  );
});

await test("every write path stamps the row with the next syncSeq", async () => {
  reset();
  const first = await saveClipboardItem(
    textItem("one", { name: "Notes", bundleId: "n" }),
    app,
  );
  let row = rowOf(first.id);
  same(row.syncSeq, head(), "insert");
  same(
    [row.createdAt, row.dateCopied, row.originDevice],
    [row.dateCopied, row.dateCopied, deviceId],
    "created here",
  );

  await delay(2);
  await saveClipboardItem(
    textItem("one", { name: "Safari", bundleId: "s" }),
    app,
  );
  row = rowOf(first.id);
  same(row.syncSeq, head(), "a repeat copy");
  same(row.sourceAppName, "Safari", "brings its app");
  same(allRows().length, 1, "and is still one row");

  const seqBeforePin = head();
  await setClipboardItemPinned(first.id, true, app);
  row = rowOf(first.id);
  check(row.syncSeq! > seqBeforePin && row.syncSeq === head(), "pin");
  check(
    row.pinnedAt !== null && row.pinnedStamp !== null,
    "pin time and stamp",
  );
  const pinStamp = row.pinnedStamp!;

  await setClipboardItemPinned(first.id, false, app);
  row = rowOf(first.id);
  check(row.pinnedAt === null, "unpinned");
  check(row.pinnedStamp! > pinStamp, "the unpin has the larger stamp");
  same(row.syncSeq, head(), "unpin");

  await softDeleteClipboardItem(first.id, app);
  row = rowOf(first.id);
  check(row.deletedAt !== null && row.syncSeq === head(), "delete");
  same(row.value, "one", "with sync off the text stays, as before");
});

await test("changesAfter returns text rows in order, with the store's head", async () => {
  reset();
  const a = await saveClipboardItem(textItem("a"), app);
  await saveClipboardItem(await imageItem("i1"), app);
  await saveClipboardItem(colorItem("#ff0000"), app);
  const b = await saveClipboardItem(textItem("b secret " + secretText), app);
  const c = await saveClipboardItem(textItem("c"), app);
  const { changes, head: storeHead } = await store.changesAfter(0, 100);
  same(
    changes.map((x) => x.record.id),
    [a.id, b.id, c.id],
    "only text, oldest first",
  );
  same(
    changes.map((x) => x.hasSecret),
    [false, true, false],
    "the secret is flagged",
  );
  same(storeHead, head(), "head");
  check(
    changes[0]!.seq < changes[1]!.seq && changes[1]!.seq < changes[2]!.seq,
    "ascending",
  );

  const page = await store.changesAfter(changes[0]!.seq, 1);
  same(
    page.changes.map((x) => x.record.id),
    [b.id],
    "after a cursor, a page at a time",
  );
  same(
    (await store.changesAfter(head(), 10)).changes.length,
    0,
    "nothing after the head",
  );
});

await test("rows that can't be read are skipped without ending the page early", async () => {
  reset();
  const ids: string[] = [];
  for (const text of ["p", "q", "r"])
    ids.push((await saveClipboardItem(textItem(text), app)).id);
  // an encrypted row whose key is gone: it can't be read, and stays saved
  run(
    database,
    `UPDATE "CLIPBOARD_ITEMS" SET value = 'AAAA', encrypted = 1 WHERE id = ?`,
    ids[1],
  );
  const { changes } = await store.changesAfter(0, 2);
  same(
    changes.map((x) => x.record.id),
    [ids[0], ids[2]],
    "the page is still full",
  );
  const rest = await store.changesAfter(changes.at(-1)!.seq, 2);
  same(rest.changes.length, 0, "and ends there");
});

await test("a transaction applies a batch and the peer's cursor together", async () => {
  reset();
  await store.transaction(async (tx) => {
    await tx.put(record("t-1", "from the peer"));
    await tx.updatePeer(peerId, {
      name: "Peer",
      platform: "mac",
      epoch: "e9",
      receivedSeq: 7,
    });
  });
  const peer = await store.getPeer(peerId);
  same(
    [peer?.name, peer?.epoch, peer?.receivedSeq],
    ["Peer", "e9", 7],
    "the cursor",
  );
  same(rowOf("t-1").value, "from the peer", "the row");
  same(rowOf("t-1").originDevice, peerId, "it keeps its origin");
  same(rowOf("t-1").syncSeq, head(), "and takes a syncSeq of its own");
});

await test("a transaction that fails changes nothing, and does not hold the history", async () => {
  reset();
  const headBefore = head();
  await rejects(
    store.transaction(async (tx) => {
      await tx.put(record("t-2", "never saved"));
      await tx.updatePeer(peerId, { receivedSeq: 99 });
      throw new Error("the disk is full");
    }),
    "the transaction",
  );
  same(allRows().length, 0, "no row");
  same((await store.getPeer(peerId))?.receivedSeq, 7, "the cursor stays");
  same(head(), headBefore, "and no number was used");
  await saveClipboardItem(textItem("works after"), app); // not stuck
  same(allRows().length, 1, "the history is writable again");
});

await test("a copy made while a batch is open waits, and survives its rollback", async () => {
  reset();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const batch = store.transaction(async (tx) => {
    await tx.put(record("t-3", "in the batch"));
    await gate;
    throw new Error("rolled back");
  });
  const batchFailed = batch.catch(() => "failed");
  await delay(10);
  let saved = false;
  const copy = saveClipboardItem(textItem("copied meanwhile"), app).then(
    (item) => {
      saved = true;
      return item;
    },
  );
  await delay(30);
  check(!saved, "the copy waits for the batch");
  release();
  same(await batchFailed, "failed", "the batch");
  const item = await copy;
  check(saved, "then it is saved");
  same(
    allRows().map((r) => r.id),
    [item.id],
    "only the copy is there",
  );
});

await test("put keeps what it can: a pin change leaves the text, its encryption and its app id", async () => {
  reset();
  await updateSettings({ encryptSecrets: true }, app);
  const item = await saveClipboardItem(
    textItem(secretText, { name: "Xcode", bundleId: "x" }),
    app,
  );
  const before = rowOf(item.id);
  same(before.encrypted, 1, "saved encrypted");
  const current = (await store.changesAfter(0, 10)).changes[0]!.record;
  await store.transaction((tx) =>
    tx.put({ ...current, pinned: { at: 9000, stamp: stampAt(9000) } }),
  );
  const after = rowOf(item.id);
  same(after.value, before.value, "the stored text is untouched");
  same(
    [after.sourceAppBundleId, after.pinnedAt, after.pinnedStamp],
    ["x", 9000, stampAt(9000)],
    "the pin",
  );
  check(after.syncSeq! > before.syncSeq!, "stamped again");
  await updateSettings({ encryptSecrets: false }, app);
});

await test("a received text is searched for secrets and links, and encrypted when set to", async () => {
  reset();
  await store.transaction(async (tx) => {
    await tx.put(record("t-4", "https://example.com/page")); // a copied link
    await tx.put(record("t-5", secretText));
  });
  same(rowOf("t-4").linkUrl, "https://example.com/page", "a link");
  check(
    rowOf("t-5").secrets !== null && rowOf("t-5").encrypted === null,
    "a secret, saved plain",
  );

  await updateSettings({ encryptSecrets: true }, app);
  await store.transaction((tx) => tx.put(record("t-6", secretText)));
  const row = rowOf("t-6");
  same(row.encrypted, 1, "encrypted");
  check(row.value !== secretText, "and not readable in the file");
  const back = (await store.changesAfter(0, 10)).changes.find(
    (c) => c.record.id === "t-6",
  );
  same(back?.record.text, secretText, "but read back whole");
  await updateSettings({ encryptSecrets: false }, app);
});

await test("a tombstone from a peer drops the text, and one for an unknown item is stored", async () => {
  reset();
  await store.transaction((tx) => tx.put(record("t-7", "to be deleted")));
  await store.transaction(async (tx) => {
    const local = (await tx.get("t-7"))!;
    await tx.put({ ...local, text: null, deletedAt: 8000 });
    await tx.put(record("t-8", null, { deletedAt: 8100 }));
  });
  for (const id of ["t-7", "t-8"]) {
    const row = rowOf(id);
    same(
      [row.value, row.secrets, row.encrypted, row.deletedAt === null],
      [null, null, null, false],
      id,
    );
  }
});

await test("a change to an id that is not a text is left alone", async () => {
  reset();
  const image = await saveClipboardItem(await imageItem("i2"), app);
  const before = rowOf(image.id);
  await store.transaction((tx) => tx.put(record(image.id, "hijack")));
  same(rowOf(image.id), before, "the image row");
});

await test("newestUnpinned is the newest unpinned text, and none when an image is newer", async () => {
  reset();
  await saveClipboardItem(textItem("older"), app);
  await delay(2);
  const newer = await saveClipboardItem(textItem("newer"), app);
  const pinned = await saveClipboardItem(textItem("pinned"), app);
  await setClipboardItemPinned(pinned.id, true, app);
  same(
    await store.transaction((tx) => tx.newestUnpinned()).then((r) => r?.id),
    newer.id,
    "skips the pinned",
  );
  await delay(2);
  await saveClipboardItem(await imageItem("i3"), app);
  same(
    await store.transaction((tx) => tx.newestUnpinned()),
    null,
    "an image is the newest copy",
  );
});

await test("pins and unpins carry rising stamps, and the clock starts past the stored ones", async () => {
  reset();
  const item = await saveClipboardItem(textItem("stamp me"), app);
  const stamps: string[] = [];
  for (const pinned of [true, false, true]) {
    await setClipboardItemPinned(item.id, pinned, app);
    stamps.push(rowOf(item.id).pinnedStamp!);
  }
  same([...stamps].sort(), stamps, "rising");
  same(await store.latestStamp(), stamps.at(-1), "the latest stamp");
  const record = (await store.changesAfter(0, 5)).changes[0]!.record;
  same(record.pinned?.stamp, stamps.at(-1), "in the record");
  // a stamp from a later time elsewhere: the next pin here is larger
  const later = stampAt(Date.now() + 5 * day);
  clock.observe(later);
  await setClipboardItemPinned(item.id, false, app);
  check(rowOf(item.id).pinnedStamp! > later, "after observing");
});

// --- tombstones, clear and trim

await test("with sync on, deleting a text leaves a tombstone; other kinds keep their row", async () => {
  reset();
  await updateSettings({ syncEnabled: true }, app);
  const text = await saveClipboardItem(textItem("gone " + secretText), app);
  const color = await saveClipboardItem(colorItem("#00ff00"), app);
  await setClipboardItemPinned(text.id, true, app);
  const seqBefore = rowOf(text.id).syncSeq!;
  await softDeleteClipboardItem(text.id, app);
  await softDeleteClipboardItem(color.id, app);
  const tomb = rowOf(text.id);
  same(
    [tomb.value, tomb.secrets, tomb.linkUrl, tomb.encrypted, tomb.pinnedAt],
    [null, null, null, null, null],
    "erased",
  );
  check(
    tomb.deletedAt !== null && tomb.syncSeq! > seqBefore,
    "deleted and stamped",
  );
  same(rowOf(color.id).value, "#00ff00", "a color keeps its value");
  const listed = await listClipboardItems(app, {
    kind: "all",
    search: "",
    limit: 50,
  });
  same(listed.items.length, 0, "neither is listed");
  const sent = (await store.changesAfter(0, 10)).changes.find(
    (c) => c.record.id === text.id,
  );
  same(
    [sent?.record.text, sent?.hasSecret],
    [null, false],
    "sent as a plain tombstone",
  );
});

await test("Clear history with sync on tombstones texts, removes the rest, keeps pinned items", async () => {
  reset();
  await updateSettings({ syncEnabled: true }, app);
  const plain = await saveClipboardItem(textItem("plain"), app);
  const pinned = await saveClipboardItem(textItem("pinned"), app);
  await setClipboardItemPinned(pinned.id, true, app);
  const image = await saveClipboardItem(await imageItem("i4"), app);
  const color = await saveClipboardItem(colorItem("#0000ff"), app);
  const imageFile = `${dataFolder}/${rowOf(image.id).path}`;
  const tombstone = await saveClipboardItem(textItem("deleted earlier"), app);
  await softDeleteClipboardItem(tombstone.id, app);
  run(
    database,
    `INSERT INTO "CLIPBOARD_ITEMS" (id, kind, dateCopied, deletedAt, syncSeq) VALUES ('stale', 'text', 1, ?, 1)`,
    Date.now() - 40 * day,
  );
  const seqBefore = head();

  await clearClipboardHistory(app);
  const left = allRows()
    .map((r) => r.id)
    .sort();
  same(
    left,
    [pinned.id, plain.id, tombstone.id].sort(),
    "pinned item and fresh tombstones remain",
  );
  same(rowOf(plain.id).value, null, "the text is gone");
  check(rowOf(plain.id).deletedAt !== null, "as a tombstone");
  check(rowOf(plain.id).syncSeq! > seqBefore, "which peers will read");
  same(rowOf(pinned.id).value, "pinned", "pinned stays whole");
  check(!(await fileExists(imageFile)), "the image file is removed");
  same(
    all(
      database,
      `SELECT 1 FROM "CLIPBOARD_ITEMS" WHERE id IN (?, ?)`,
      color.id,
      image.id,
    ).length,
    0,
    "image and color rows",
  );
  same(
    new Set(allRows().map((r) => r.syncSeq)).size,
    allRows().length,
    "each tombstone has its own number",
  );
});

await test("Clear history with sync off removes every unpinned row, as before", async () => {
  reset();
  await updateSettings({ syncEnabled: false }, app);
  const plain = await saveClipboardItem(textItem("plain"), app);
  const pinned = await saveClipboardItem(textItem("pinned"), app);
  await setClipboardItemPinned(pinned.id, true, app);
  await clearClipboardHistory(app);
  same(
    allRows().map((r) => r.id),
    [pinned.id],
    "only the pinned one",
  );
  check(!allRows().some((r) => r.id === plain.id), "plain is gone");
});

await test("history limits leave young tombstones alone and don't count them", async () => {
  reset();
  await updateSettings({ syncEnabled: true }, app);
  // deleted before sync: its text is still there, and a limit takes it
  const old = await saveClipboardItem(textItem("pre-sync"), app);
  run(
    database,
    `UPDATE "CLIPBOARD_ITEMS" SET deletedAt = ? WHERE id = ?`,
    Date.now(),
    old.id,
  );
  await delay(2);
  const live: string[] = [];
  for (const text of ["l1", "l2", "l3"]) {
    live.push((await saveClipboardItem(textItem(text), app)).id);
    await delay(2);
  }
  const doomed: string[] = [];
  for (const text of ["d1", "d2", "d3"]) {
    const id = (await saveClipboardItem(textItem(text), app)).id;
    await softDeleteClipboardItem(id, app);
    doomed.push(id);
    await delay(2);
  }

  // the newest 2 are l3 and l2: l1 is over the limit, as is the older pre-sync row
  same(
    await countClipboardItemsToDelete(app, 0, 2),
    1,
    "one live item is over a limit of 2",
  );
  await deleteClipboardItems(app, 0, 2); // keep the newest 2
  const ids = allRows().map((r) => r.id);
  for (const id of doomed) check(ids.includes(id), `tombstone ${id} kept`);
  check(!ids.includes(old.id), "the pre-sync deleted row went");
  same(
    live.filter((id) => ids.includes(id)),
    live.slice(1),
    "the oldest live one went, not a newer one",
  );

  await deleteClipboardItems(app, Date.now() + day, -1); // everything is older
  same(
    allRows()
      .map((r) => r.id)
      .sort(),
    [...doomed].sort(),
    "only tombstones remain",
  );
  const sizes = await listClipboardItemSizes(app);
  same(sizes.length, 0, "and they are not counted as history");
});

await test("tombstones are removed after 30 days, nothing else is", async () => {
  reset();
  const insert = `INSERT INTO "CLIPBOARD_ITEMS" (id, kind, value, dateCopied, deletedAt, syncSeq) VALUES (?, 'text', ?, 1, ?, ?)`;
  run(database, insert, "young", null, Date.now() - tombstoneLifetime + day, 1);
  run(database, insert, "old", null, Date.now() - tombstoneLifetime - day, 2);
  run(
    database,
    insert,
    "kept-text",
    "still has text",
    Date.now() - 90 * day,
    3,
  );
  await purgeOldTombstones(app);
  same(
    allRows()
      .map((r) => r.id)
      .sort(),
    ["kept-text", "young"],
    "old one purged",
  );
});

// --- the engine on the SQLite store

await test("a Mac's history and a second device end up the same, through the real store", async () => {
  reset();
  await updateSettings({ syncEnabled: true }, app);
  const network = new TestNetwork();
  const other = network.add("b");
  let allowSecrets = false;
  let itemsChanged = 0;
  const errors: unknown[] = [];
  const makeEngine = () =>
    new SyncEngine({
      deviceId,
      name: "Test Mac",
      platform: "mac",
      vaultKey: network.vaultKey,
      store: new SqliteSyncStore(app),
      syncSecrets: () => allowSecrets,
      clock,
      scheduler: network.scheduler,
      onItemsChanged: () => void (itemsChanged += 1),
      onError: (error) => errors.push(error),
    });
  let engine = makeEngine();
  const connect = async () => {
    const pair = memoryChannelPair();
    void engine.attach(pair.initiator);
    void other.engine.attach(pair.responder);
    await until(
      () =>
        pair.pending() === 0 &&
        engine.isIdle() &&
        other.engine.isIdle() &&
        engine.peers().length === 1,
      "the devices to settle",
    );
    return pair;
  };
  const settle = () =>
    until(
      () => engine.isIdle() && other.engine.isIdle(),
      "the engines to go idle",
    );

  // history that exists before sync is turned on
  const one = await saveClipboardItem(textItem("e2e one"), app);
  const two = await saveClipboardItem(textItem("e2e two"), app);
  await setClipboardItemPinned(two.id, true, app);
  await saveClipboardItem(textItem("e2e secret " + secretText), app);
  await saveClipboardItem(await imageItem("i5"), app);
  await saveClipboardItem(colorItem("#123456"), app);

  let pair = await connect();
  same(
    other.store.liveTexts().sort(),
    ["e2e one", "e2e two"],
    "existing history arrives, minus the secret and non-text",
  );
  const received = other.store.snapshot().find((r) => r.id === two.id);
  same(received?.pinned?.at !== null, true, "with its pin");
  same(received?.origin, deviceId, "and its origin");

  // the other device copies, pins and deletes
  other.copy("from b");
  const bOne = other.store.snapshot().find((r) => r.text === "from b")!;
  other.pin(one.id, true);
  await settle();
  const arrived = rowOf(bOne.id);
  same(
    [arrived.value, arrived.originDevice],
    ["from b", other.id],
    "its copy arrives",
  );
  check(rowOf(one.id).pinnedAt !== null, "its pin arrives");
  check(
    clock.next() > rowOf(one.id).pinnedStamp!,
    "and this clock moves past its stamp",
  );

  // here: delete one, with a tombstone for the other device to read
  await softDeleteClipboardItem(two.id, app);
  engine.localChanged();
  await settle();
  const gone = other.store.snapshot().find((r) => r.id === two.id);
  same(
    [gone?.text, gone?.deletedAt !== null],
    [null, true],
    "a delete here is read there",
  );

  // Clear history here
  await clearClipboardHistory(app);
  engine.localChanged();
  await settle();
  same(
    other.store.liveTexts(),
    ["e2e one"],
    "clearing here clears there, except what is pinned",
  );

  // reconnecting sends nothing again, also after a restart: the cursor is saved
  const headBefore = head();
  const changedBefore = itemsChanged;
  pair.initiator.close("test");
  await settle();
  engine.stop();
  engine = makeEngine(); // a restart: nothing in memory
  pair = await connect();
  same(head(), headBefore, "no row was written again");
  same(itemsChanged, changedBefore, "nothing arrived again");
  const peer = await new SqliteSyncStore(app).getPeer(other.id);
  same(
    peer?.receivedSeq,
    other.store.head,
    "the cursor into the other device is saved",
  );

  // converged
  const mine = (
    await new SqliteSyncStore(app).changesAfter(0, 1000)
  ).changes.map((c) => c.record);
  for (const theirs of other.store.snapshot()) {
    const ours = mine.find((r) => r.id === theirs.id);
    check(
      ours && isSameRecord(ours, theirs),
      `record ${theirs.id} is the same on both`,
    );
  }
  same(
    mine
      .filter((r) => r.deletedAt === null)
      .map((r) => r.text)
      .sort(),
    other.store.liveTexts().sort(),
    "the same live texts",
  );
  same(errors.length, 0, `no engine errors: ${errors.map(String).join("; ")}`);
  engine.stop();
  network.stop();
});

await test("restampSecretItems sends the rows holding secrets again, and only those", async () => {
  reset();
  const plain = await saveClipboardItem(textItem("plain"), app);
  const secret = await saveClipboardItem(
    textItem("a secret " + secretText),
    app,
  );
  await updateSettings({ encryptSecrets: true }, app);
  const sealed = await saveClipboardItem(textItem("sealed " + secretText), app);
  await updateSettings({ encryptSecrets: false }, app);
  check(rowOf(sealed.id).encrypted === 1, "one of them is saved encrypted");
  // as an older Teneo left it: encrypted, before any secret was recorded for it
  run(
    database,
    `UPDATE "CLIPBOARD_ITEMS" SET secrets = NULL WHERE id = ?`,
    sealed.id,
  );
  // deleted while sync was off: its text and its secret are still there
  const syncWasOn = getSettings().syncEnabled;
  await updateSettings({ syncEnabled: false }, app);
  const gone = await saveClipboardItem(textItem("gone " + secretText), app);
  await softDeleteClipboardItem(gone.id, app);
  await updateSettings({ syncEnabled: syncWasOn }, app);
  check(rowOf(gone.id).secrets !== null, "it still holds its secret");

  const readPast = head(); // a device that has read everything so far
  const places = {
    plain: rowOf(plain.id).syncSeq,
    gone: rowOf(gone.id).syncSeq,
  };
  same(
    await restampSecretItems(app),
    2,
    "the plain secret and the encrypted one",
  );
  same(rowOf(plain.id).syncSeq, places.plain, "a plain text keeps its place");
  same(rowOf(gone.id).syncSeq, places.gone, "a deleted one keeps its place");

  const again = await store.changesAfter(readPast, 100);
  same(
    again.changes.map((change) => change.record.id).sort(),
    [secret.id, sealed.id].sort(),
    "the device that had read past them reads them again",
  );
  same(
    again.changes.map((change) => change.hasSecret),
    [true, true],
    "still marked as holding secrets",
  );
});

await test("forgetPeers forgets the paired devices and nothing else", async () => {
  reset();
  await store.transaction(async (tx) => {
    await tx.put(record("t-forget", "kept"));
    await tx.updatePeer(peerId, {
      name: "Peer",
      platform: "mac",
      epoch: "e1",
      receivedSeq: 3,
    });
  });
  check(
    (await store.listPeers()).some((peer) => peer.deviceId === peerId),
    "the device is paired",
  );
  await store.forgetPeers();
  same(await store.listPeers(), [], "no device is left");
  same(await store.getPeer(peerId), null, "and its cursor went with it");
  same(rowOf("t-forget").value, "kept", "the history stays");
});

await tjs.remove(folder).catch(() => {});
finish();
