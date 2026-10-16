import { onMounted, onUnmounted, ref } from "vue";

import type { ClipboardHistoryItem } from "@/types/clipboard";

export function useClipboard() {
  const clipboardItems = ref<ClipboardHistoryItem[]>([]);
  const error = ref<Error | null>(null);
  const loading = ref(true);
  const pendingItems: ClipboardHistoryItem[] = [];
  let historyLoaded = false;
  let unsubscribeFromClipboardItems: (() => void) | undefined;

  onMounted(() => {
    unsubscribeFromClipboardItems = tiny.api.on("clipboard-item", (item) => {
      if (!isClipboardHistoryItem(item)) return;
      if (!historyLoaded) {
        pendingItems.push(item);
        return;
      }
      addClipboardItem(item);
    });
    void loadClipboardItems();
  });

  onUnmounted(() => unsubscribeFromClipboardItems?.());

  async function loadClipboardItems(): Promise<ClipboardHistoryItem[]> {
    loading.value = true;
    error.value = null;

    try {
      const apiResult: unknown = await tiny.api.call("clipboardItems");
      const savedItems = Array.isArray(apiResult)
        ? apiResult.filter(isClipboardHistoryItem)
        : [];
      clipboardItems.value = mergeClipboardItems(
        pendingItems.splice(0),
        clipboardItems.value,
        savedItems,
      );
    } catch (reason) {
      error.value = toError(reason);
      clipboardItems.value = mergeClipboardItems(
        pendingItems.splice(0),
        clipboardItems.value,
      );
    } finally {
      historyLoaded = true;
      loading.value = false;
    }

    return clipboardItems.value;
  }

  function addClipboardItem(item: ClipboardHistoryItem): void {
    error.value = null;
    clipboardItems.value = mergeClipboardItems([item], clipboardItems.value);
  }

  return { clipboardItems, error, loading, loadClipboardItems };
}

function mergeClipboardItems(
  ...itemGroups: ClipboardHistoryItem[][]
): ClipboardHistoryItem[] {
  const itemsById = new Map<string, ClipboardHistoryItem>();
  for (const items of itemGroups) {
    for (const item of items) {
      if (!itemsById.has(item.id)) itemsById.set(item.id, item);
    }
  }
  return [...itemsById.values()].sort(
    (firstItem, secondItem) => secondItem.dateCopied - firstItem.dateCopied,
  );
}

function isClipboardHistoryItem(value: unknown): value is ClipboardHistoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === "string" &&
    typeof item.dateCopied === "number" &&
    (item.kind === "text" ||
      item.kind === "image" ||
      item.kind === "files" ||
      item.kind === "color")
  );
}

function toError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new Error("Could not load clipboard history");
}
