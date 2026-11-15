import {
  type ContractSeed,
  defineClientContract,
  pause,
} from "./client-contract";
import type { HistoryPlugin } from "./history-plugin";
import { NativeClient } from "./native-client";
import { History } from "./native-history";

// The client contract against the phone's native history, in the app's web
// view. Only a debug build opens the test database it uses, and the app's own
// history is never touched. scripts/native-contract.ts runs it over adb.

const database = "contract-run.sqlite";

interface Outcome {
  name: string;
  error?: string;
}

/** Run every contract test against NativeClient, one after another */
export async function runNativeContract(
  plugin: HistoryPlugin = History,
): Promise<Outcome[]> {
  const tests: { name: string; run: () => Promise<void> }[] = [];
  const opened: NativeClient[] = [];

  async function make(seed: ContractSeed[]) {
    await Promise.all(opened.splice(0).map((client) => client.close()));
    await plugin.resetTestDatabase({ database });
    const client = new NativeClient(plugin, { database });
    opened.push(client);
    if (seed.length > 0) {
      await client.updateSettings({ historyRetentionDays: 0, maxItems: 0 });
    }
    const ids: string[] = [];
    for (const item of seed) {
      const { id } = await plugin.saveText({
        database,
        text: item.text,
        dateCopied: item.dateCopied,
        sourceAppName: item.sourceAppName ?? null,
        secrets: item.secrets ?? [],
        link: item.link ?? null,
      });
      ids.push(id);
    }
    for (const [index, item] of seed.entries()) {
      if (!item.pinned) continue;
      await client.setPinned(ids[index]!, true);
      await pause(2);
    }
    return client;
  }

  defineClientContract((name, run) => tests.push({ name, run }), make);

  // what only the native history does: saving
  tests.push({
    name: "saving the newest unpinned text again bumps it instead of adding it",
    run: async () => {
      const client = await make([]);
      await client.updateSettings({ historyRetentionDays: 0, maxItems: 0 });
      const first = await plugin.saveText({
        database,
        text: "a",
        dateCopied: 1000,
      });
      await plugin.saveText({ database, text: "b", dateCopied: 2000 });
      const third = await plugin.saveText({
        database,
        text: "a",
        dateCopied: 3000,
      });
      if (third.id === first.id) throw new Error("an older copy was bumped");
      const again = await plugin.saveText({
        database,
        text: "a",
        dateCopied: 4000,
      });
      if (again.id !== third.id)
        throw new Error("the newest copy wasn't bumped");
      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });
      const shown = page.items.map((item) => `${item.text}@${item.dateCopied}`);
      if (shown.join() !== "a@4000,b@2000,a@1000") {
        throw new Error(`history is ${shown.join()}`);
      }
    },
  });
  tests.push({
    name: "saving applies Maximum items",
    run: async () => {
      const client = await make([]);
      await client.updateSettings({ maxItems: 2, historyRetentionDays: 0 });
      const now = Date.now();
      for (const [index, text] of ["1", "2", "3"].entries()) {
        await plugin.saveText({ database, text, dateCopied: now + index });
      }
      const page = await client.listItems({
        kind: "all",
        search: "",
        limit: 10,
      });
      const shown = page.items.map((item) => item.text).join();
      if (shown !== "3,2") throw new Error(`history is ${shown}`);
    },
  });

  const outcomes: Outcome[] = [];
  for (const { name, run } of tests) {
    try {
      await run();
      outcomes.push({ name });
    } catch (caught) {
      outcomes.push({
        name,
        error: caught instanceof Error ? caught.message : String(caught),
      });
    }
  }
  await Promise.all(opened.map((client) => client.close()));
  await plugin.resetTestDatabase({ database });
  return outcomes;
}
