import type {
  ClipboardHistoryItem,
  ClipboardLink,
  ClipboardListRequest,
  SecretSpan,
} from "@teneo/shared/types/clipboard";

import type { TeneoClient } from "../types/client";
import { defaultSettings } from "../types/settings";

// What every TeneoClient does with the history and settings, run against the
// fake client by bun (client-contract.test.ts) and against the phone's native
// history in the app itself (run-native-contract.ts). No test library here:
// the app's web view has none, so the checks throw on their own.

/** A text the history holds before a test starts */
export interface ContractSeed {
  text: string;
  dateCopied: number;
  /** pinned after every seed is saved, in seed order */
  pinned?: boolean;
  sourceAppName?: string | null;
  secrets?: SecretSpan[];
  link?: ClipboardLink | null;
}

/**
 * A client whose history holds `seed`, saved in order, and nothing else. With
 * a seed, the history limits are off ("Forever", "Unlimited") so old seeds
 * stay; with none, the settings are a new install's.
 */
export type MakeClient = (seed: ContractSeed[]) => Promise<TeneoClient>;

export type DefineTest = (name: string, run: () => Promise<void>) => void;

const DAY_MS = 24 * 60 * 60 * 1000;

export function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function assertEqual(actual: unknown, expected: unknown, what: string) {
  const a = stableJson(actual);
  const e = stableJson(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

export async function assertRejects(promise: Promise<unknown>, what: string) {
  try {
    await promise;
  } catch {
    return;
  }
  throw new Error(`${what}: expected it to reject`);
}

/** Wait until `check` holds, for listeners that hear of a change a little later */
export async function waitFor(check: () => boolean, what: string) {
  for (let waited = 0; waited < 2000; waited += 10) {
    if (check()) return;
    await pause(10);
  }
  throw new Error(`${what}: still not so after 2s`);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, inner: unknown) =>
    inner && typeof inner === "object" && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : inner,
  );
}

async function listAll(
  client: TeneoClient,
  request: Partial<ClipboardListRequest> = {},
): Promise<ClipboardHistoryItem[]> {
  const page = await client.listItems({
    kind: "all",
    search: "",
    limit: 1000,
    ...request,
  });
  return page.items;
}

async function texts(client: TeneoClient, search = ""): Promise<string[]> {
  return (await listAll(client, { search })).map((item) => item.text ?? "");
}

async function idOf(client: TeneoClient, text: string): Promise<string> {
  const item = (await listAll(client)).find((i) => i.text === text);
  if (!item) throw new Error(`"${text}" isn't in the history`);
  return item.id;
}

export function defineClientContract(test: DefineTest, make: MakeClient) {
  const now = Date.now();

  test("a new history is empty", async () => {
    const client = await make([]);
    const page = await client.listItems({ kind: "all", search: "", limit: 50 });
    assertEqual(page, { items: [], nextCursor: null, total: 0 }, "first page");
  });

  test("lists pinned items first, newest pin first, then newest copy first", async () => {
    const client = await make([
      { text: "A", dateCopied: now - 4000 },
      { text: "B", dateCopied: now - 3000 },
      { text: "C", dateCopied: now - 2000 },
      { text: "D", dateCopied: now - 1000 },
    ]);
    await client.setPinned(await idOf(client, "B"), true);
    await pause(5);
    await client.setPinned(await idOf(client, "A"), true);
    assertEqual(await texts(client), ["A", "B", "D", "C"], "order");
    const items = await listAll(client);
    assertEqual(
      items.map((item) => item.pinned),
      [true, true, false, false],
      "pinned",
    );

    await client.setPinned(await idOf(client, "A"), false);
    assertEqual(await texts(client), ["B", "D", "C", "A"], "after unpinning");
  });

  test("pages with a cursor, never skipping or repeating, counting on the first page only", async () => {
    const client = await make([
      { text: "one", dateCopied: now - 6000, pinned: true },
      { text: "two", dateCopied: now - 5000 },
      { text: "three", dateCopied: now - 4000, pinned: true },
      // the same time: the id puts them in order
      { text: "four", dateCopied: now - 3000 },
      { text: "five", dateCopied: now - 3000 },
      { text: "six", dateCopied: now - 2000 },
      { text: "seven", dateCopied: now - 1000 },
    ]);
    const whole = (await listAll(client)).map((item) => item.id);
    assertEqual(whole.length, 7, "items in all");

    const paged: string[] = [];
    const totals: (number | null)[] = [];
    let cursor: ClipboardListRequest["cursor"];
    for (let pages = 0; pages < 10; pages++) {
      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 2,
        ...(cursor && { cursor }),
      });
      paged.push(...page.items.map((item) => item.id));
      totals.push(page.total);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    assertEqual(paged, whole, "paged ids");
    assertEqual(totals[0], 7, "first page's total");
    assertEqual(
      totals.slice(1).every((total) => total === null),
      true,
      "later totals are null",
    );
  });

  test("a page after a cursor carries on when the history changed in between", async () => {
    const client = await make([
      { text: "old", dateCopied: now - 3000 },
      { text: "middle", dateCopied: now - 2000 },
      { text: "new", dateCopied: now - 1000 },
    ]);
    const first = await client.listItems({ kind: "all", search: "", limit: 1 });
    assertEqual(first.items[0]?.text, "new", "first page");
    await client.deleteItem(await idOf(client, "new"));
    const second = await client.listItems({
      kind: "all",
      search: "",
      limit: 5,
      cursor: first.nextCursor!,
    });
    assertEqual(
      second.items.map((item) => item.text),
      ["middle", "old"],
      "next page",
    );
  });

  test("searches the text, source app, link host and secret labels, ignoring case", async () => {
    // shaped like a key: long enough that the card shows its last 4 characters
    const key = `${"x".repeat(36)}9876`;
    const client = await make([
      {
        text: "SELECT * FROM users",
        dateCopied: now - 5000,
        sourceAppName: "Terminal",
      },
      {
        text: "select id from accounts",
        dateCopied: now - 4000,
        sourceAppName: "Notes",
      },
      {
        text: "https://www.example.org/page",
        dateCopied: now - 3000,
        link: { url: "https://www.example.org/page", host: "example.org" },
      },
      {
        text: `token ${key} end`,
        dateCopied: now - 2000,
        secrets: [{ start: 6, end: 6 + key.length, label: "GitHub token" }],
      },
      { text: "100% sure", dateCopied: now - 1500 },
      { text: "1000 items", dateCopied: now - 1000 },
    ]);
    assertEqual(
      await texts(client, "select"),
      ["select id from accounts", "SELECT * FROM users"],
      "text",
    );
    assertEqual(
      await texts(client, "  SeLeCt  "),
      await texts(client, "select"),
      "trimmed",
    );
    assertEqual(
      await texts(client, "terminal"),
      ["SELECT * FROM users"],
      "source app",
    );
    assertEqual(
      await texts(client, "example"),
      ["https://www.example.org/page"],
      "link",
    );
    assertEqual(
      await texts(client, "github"),
      [`token ${key} end`],
      "secret label",
    );
    assertEqual(await texts(client, "%"), ["100% sure"], "a % is no wildcard");
    assertEqual(await texts(client, "_"), [], "a _ is no wildcard");

    const page = await client.listItems({
      kind: "all",
      search: "select",
      limit: 1,
    });
    assertEqual(page.total, 2, "total of a search");
  });

  test("with secrets hidden, a search finds a secret by what the card shows only", async () => {
    // shaped like a key: long enough that the card shows its last 4 characters
    const key = `${"x".repeat(36)}9876`;
    const client = await make([
      {
        text: `token ${key} end`,
        dateCopied: now - 1000,
        secrets: [{ start: 6, end: 6 + key.length, label: "GitHub token" }],
      },
    ]);
    assertEqual(
      (await client.getSettings()).hideSecrets,
      true,
      "hidden by default",
    );
    assertEqual(await texts(client, "xxxxxxxx"), [], "inside the key");
    assertEqual(
      await texts(client, "9876"),
      [`token ${key} end`],
      "the shown end",
    );
    assertEqual(
      await texts(client, "token"),
      [`token ${key} end`],
      "around the key",
    );
    const hidden = await client.listItems({
      kind: "all",
      search: "xxxxxxxx",
      limit: 5,
    });
    assertEqual(hidden.total, 0, "count inside the key");

    await client.updateSettings({ hideSecrets: false });
    assertEqual(
      await texts(client, "xxxxxxxx"),
      [`token ${key} end`],
      "shown key",
    );
  });

  test("the list carries the start of a long text, getItem all of it", async () => {
    const long = "x".repeat(1500);
    const client = await make([
      { text: long, dateCopied: now - 2000 },
      { text: "short", dateCopied: now - 1000 },
    ]);
    const [short, cut] = await listAll(client);
    assertEqual(
      [short?.text, short?.isTruncated],
      ["short", false],
      "short text",
    );
    assertEqual(
      [cut?.text?.length, cut?.isTruncated],
      [1000, true],
      "long text",
    );
    const whole = await client.getItem(cut!.id);
    assertEqual([whole?.text, whole?.isTruncated], [long, false], "getItem");
  });

  test("the list's cut leaves out a secret it would split", async () => {
    const text = `${"a".repeat(990)}${"S".repeat(20)}${"b".repeat(100)}`;
    const secrets = [{ start: 990, end: 1010, label: "API key" }];
    const client = await make([{ text, dateCopied: now - 1000, secrets }]);
    const [item] = await listAll(client);
    assertEqual([item?.text?.length, item?.secrets], [990, []], "cut");
    assertEqual((await client.getItem(item!.id))?.secrets, secrets, "getItem");
  });

  test("getItem of an unknown id is null", async () => {
    const client = await make([{ text: "a", dateCopied: now - 1000 }]);
    assertEqual(await client.getItem("no-such-item"), null, "unknown id");
  });

  test("a pin or a delete tells the listeners; an unsubscribed one hears nothing", async () => {
    const client = await make([
      { text: "a", dateCopied: now - 2000 },
      { text: "b", dateCopied: now - 1000 },
    ]);
    let heard = 0;
    let heardAfterLeaving = 0;
    const stop = client.onHistoryChanged(() => heard++);
    const left = client.onHistoryChanged(() => heardAfterLeaving++);
    left();

    await client.setPinned(await idOf(client, "a"), true);
    await waitFor(() => heard === 1, "heard the pin");
    await client.deleteItem(await idOf(client, "b"));
    await waitFor(() => heard === 2, "heard the delete");
    stop();
    await client.setPinned(await idOf(client, "a"), false);
    await pause(50);
    assertEqual([heard, heardAfterLeaving], [2, 0], "times heard");
  });

  test("a deleted item is gone from the list and getItem, pinned or not", async () => {
    const client = await make([
      { text: "a", dateCopied: now - 3000, pinned: true },
      { text: "b", dateCopied: now - 2000 },
      { text: "c", dateCopied: now - 1000 },
    ]);
    const a = await idOf(client, "a");
    const b = await idOf(client, "b");
    await client.deleteItem(a);
    await client.deleteItem(b);
    assertEqual(await client.getItem(a), null, "getItem of a pinned one");
    assertEqual(await client.getItem(b), null, "getItem");
    const page = await client.listItems({ kind: "all", search: "", limit: 10 });
    assertEqual(
      [page.items.map((item) => item.text), page.total],
      [["c"], 1],
      "list",
    );
    // deleting it again changes nothing
    await client.deleteItem(b);
    assertEqual(await texts(client), ["c"], "deleted twice");
  });

  test("copying an item leaves the history as it was; an unknown one rejects", async () => {
    const client = await make([
      { text: "a", dateCopied: now - 2000 },
      { text: "b", dateCopied: now - 1000 },
    ]);
    const before = await listAll(client);
    await client.copyToClipboard(await idOf(client, "a"));
    await client.copyText("A");
    assertEqual(await listAll(client), before, "history");
    await assertRejects(client.copyToClipboard("no-such-item"), "unknown id");
  });

  test("settings start as a new install's and keep each change", async () => {
    const client = await make([]);
    assertEqual(await client.getSettings(), defaultSettings, "defaults");
    const updated = await client.updateSettings({
      hideSecrets: false,
      captureOnOpen: true,
    });
    const expected = {
      ...defaultSettings,
      hideSecrets: false,
      captureOnOpen: true,
    };
    assertEqual(updated, expected, "returned");
    assertEqual(await client.getSettings(), expected, "read again");
  });

  test("Maximum items deletes the oldest unpinned items, and pinned ones don't count", async () => {
    const client = await make([
      { text: "pinned", dateCopied: now - 9000, pinned: true },
      { text: "1", dateCopied: now - 5000 },
      { text: "2", dateCopied: now - 4000 },
      { text: "3", dateCopied: now - 3000 },
      { text: "4", dateCopied: now - 2000 },
    ]);
    let heard = 0;
    client.onHistoryChanged(() => heard++);
    await client.updateSettings({ maxItems: 2 });
    assertEqual(await texts(client), ["pinned", "4", "3"], "kept");
    await waitFor(() => heard > 0, "heard the trim");

    await client.updateSettings({ maxItems: 0 });
    assertEqual(
      await texts(client),
      ["pinned", "4", "3"],
      "unlimited keeps all",
    );
  });

  test("Keep history for deletes older copies, never pinned ones", async () => {
    const client = await make([
      { text: "old pinned", dateCopied: now - 40 * DAY_MS, pinned: true },
      { text: "old", dateCopied: now - 40 * DAY_MS },
      { text: "week old", dateCopied: now - 7 * DAY_MS },
      { text: "today", dateCopied: now - 1000 },
    ]);
    await client.updateSettings({ historyRetentionDays: 30 });
    assertEqual(
      await texts(client),
      ["old pinned", "today", "week old"],
      "a month",
    );
    await client.updateSettings({ historyRetentionDays: 1 });
    assertEqual(await texts(client), ["old pinned", "today"], "a day");
  });
}
