import { onMounted, onUnmounted, ref } from "vue";

import type { ClipboardHistoryItem } from "@/types/clipboard";

// Module state is a singleton for every component in one webview window.
// Separate native windows receive their own store and sync through backend push events.
const clipboardItems = ref<ClipboardHistoryItem[]>([]);
const error = ref<Error | null>(null);
const loading = ref(false);
const pendingItems: ClipboardHistoryItem[] = [];
let historyLoaded = false;
let consumerCount = 0;
let unsubscribeFromClipboardItems: (() => void) | undefined;

export function useClipboard() {
  onMounted(() => {
    consumerCount += 1;
    if (consumerCount === 1) startClipboardStore();
  });

  onUnmounted(() => {
    consumerCount = Math.max(0, consumerCount - 1);
    if (consumerCount === 0) stopClipboardStore();
  });

  return { clipboardItems, error, loading, loadClipboardItems };
}

function startClipboardStore(): void {
  historyLoaded = false;
  clipboardItems.value = [];
  unsubscribeFromClipboardItems = tiny.api.on("clipboard-item", (item) => {
    if (!isClipboardHistoryItem(item)) return;
    if (!historyLoaded) {
      pendingItems.push(item);
      return;
    }
    addClipboardItem(item);
  });
  void loadClipboardItems();
}

function stopClipboardStore(): void {
  unsubscribeFromClipboardItems?.();
  unsubscribeFromClipboardItems = undefined;
  pendingItems.length = 0;
  historyLoaded = false;
}

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
      historyLoaded ? clipboardItems.value : [],
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
