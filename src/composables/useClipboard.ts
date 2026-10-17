import {
  type QueryClient,
  useQuery,
  useQueryClient,
} from "@tanstack/vue-query";
import { computed, onMounted, onUnmounted } from "vue";

import {
  clipboardHistoryChangedEvent,
  type ClipboardHistoryItem,
} from "@/types/clipboard";

export const clipboardItemsQueryKey = ["clipboard-items"] as const;
const clipboardItemsCacheDuration = 5 * 60 * 1000;
const clipboardItemsQueryOptions = {
  queryKey: clipboardItemsQueryKey,
  queryFn: fetchClipboardItems,
  staleTime: clipboardItemsCacheDuration,
  gcTime: clipboardItemsCacheDuration,
};

let consumerCount = 0;
let historyChangeVersion = 0;
let loadPromise: Promise<ClipboardHistoryItem[]> | undefined;
let stopStoreTimeout: ReturnType<typeof setTimeout> | undefined;
let unsubscribeFromClipboardHistory: (() => void) | undefined;

export function useClipboard() {
  const queryClient = useQueryClient();
  const clipboardQuery = useQuery({
    ...clipboardItemsQueryOptions,
    enabled: false,
  });
  const clipboardItems = computed(() => clipboardQuery.data.value ?? []);

  onMounted(() => {
    consumerCount += 1;
    if (stopStoreTimeout) {
      clearTimeout(stopStoreTimeout);
      stopStoreTimeout = undefined;
    }
    if (consumerCount === 1) startClipboardStore(queryClient);
  });

  onUnmounted(() => {
    consumerCount = Math.max(0, consumerCount - 1);
    if (consumerCount === 0) scheduleClipboardStoreStop();
  });

  return {
    clipboardItems,
    error: clipboardQuery.error,
    loading: clipboardQuery.isPending,
    loadClipboardItems: () => loadClipboardItems(queryClient),
  };
}

function startClipboardStore(queryClient: QueryClient): void {
  if (!unsubscribeFromClipboardHistory) {
    unsubscribeFromClipboardHistory = tiny.api.on(
      clipboardHistoryChangedEvent,
      () => {
        historyChangeVersion += 1;
        void queryClient.invalidateQueries({
          queryKey: clipboardItemsQueryKey,
          refetchType: "none",
        });

        if (consumerCount > 0) void loadClipboardItems(queryClient);
      },
    );
  }
  void loadClipboardItems(queryClient);
}

function scheduleClipboardStoreStop(): void {
  stopStoreTimeout = setTimeout(() => {
    unsubscribeFromClipboardHistory?.();
    unsubscribeFromClipboardHistory = undefined;
    stopStoreTimeout = undefined;
  }, clipboardItemsCacheDuration);
}

function loadClipboardItems(
  queryClient: QueryClient,
): Promise<ClipboardHistoryItem[]> {
  loadPromise ??= fetchClipboardItemsFromDatabase(queryClient).finally(() => {
    loadPromise = undefined;
  });
  return loadPromise;
}

async function fetchClipboardItemsFromDatabase(
  queryClient: QueryClient,
): Promise<ClipboardHistoryItem[]> {
  try {
    while (true) {
      const versionBeforeFetch = historyChangeVersion;
      const savedItems = await queryClient.fetchQuery(
        clipboardItemsQueryOptions,
      );

      if (versionBeforeFetch === historyChangeVersion) return savedItems;

      await queryClient.invalidateQueries({
        queryKey: clipboardItemsQueryKey,
        refetchType: "none",
      });
    }
  } catch {
    const cachedItems =
      queryClient.getQueryData<ClipboardHistoryItem[]>(
        clipboardItemsQueryKey,
      ) ?? [];
    return cachedItems;
  }
}

async function fetchClipboardItems(): Promise<ClipboardHistoryItem[]> {
  const apiResult: unknown = await tiny.api.call("clipboardItems");
  return Array.isArray(apiResult)
    ? apiResult.filter(isClipboardHistoryItem)
    : [];
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
