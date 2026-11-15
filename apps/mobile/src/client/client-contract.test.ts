import { test } from "bun:test";

import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";

import {
  type ContractSeed,
  defineClientContract,
  pause,
} from "./client-contract";
import { FakeClient } from "./fake-client";

function toItem(seed: ContractSeed, index: number): ClipboardHistoryItem {
  return {
    id: `seed-${String(index).padStart(3, "0")}`,
    dateCopied: seed.dateCopied,
    kind: "text",
    changeCount: seed.dateCopied,
    text: seed.text,
    html: null,
    paths: [],
    image: null,
    imageSize: null,
    color: null,
    concealed: false,
    sourceApp: seed.sourceAppName
      ? { name: seed.sourceAppName, bundleId: null }
      : null,
    sourceURL: null,
    pinned: false,
    pasteAsFile: false,
    fileSize: null,
    secrets: seed.secrets ?? [],
    link: seed.link ?? null,
    isTruncated: false,
  };
}

defineClientContract(
  (name, run) => test(`FakeClient: ${name}`, run),
  async (seed) => {
    const client = new FakeClient(seed.map(toItem), async () => {});
    if (seed.length > 0) {
      await client.updateSettings({ historyRetentionDays: 0, maxItems: 0 });
    }
    for (const [index, item] of seed.entries()) {
      if (!item.pinned) continue;
      await client.setPinned(toItem(item, index).id, true);
      await pause(2);
    }
    return client;
  },
);
