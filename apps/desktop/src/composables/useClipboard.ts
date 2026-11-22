import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/vue-query";
import {
  computed,
  type MaybeRefOrGetter,
  onMounted,
  onUnmounted,
  toValue,
} from "vue";

import {
  clipboardHistoryChangedEvent,
  type ClipboardHistoryItem,
  type ClipboardListCursor,
  type ClipboardListPage,
  type ClipboardListRequest,
} from "@/types/clipboard";
import { isPanelHidden } from "@/utils/panel-reset";

export const clipboardItemsQueryKey = ["clipboard-items"] as const;
export const clipboardItemQueryKey = ["clipboard-item"] as const;
export const clipboardCacheDuration = 5 * 60 * 1000;
/** Items per page: a panel's worth and some to scroll into before the next loads */
export const clipboardPageSize = 50;

export type ClipboardListFilter = Pick<ClipboardListRequest, "kind" | "search">;
export type ClipboardListData = InfiniteData<
  ClipboardListPage,
  ClipboardListCursor | undefined
>;

/**
 * The history for one tab and search, a page at a time: the first page loads
 * with the panel, loadMore fetches the next as the list nears its end. The
 * backend's change event refetches what's loaded, so a copy, pin or delete
 * shows at once.
 */
export function useClipboardList(
  filter: MaybeRefOrGetter<ClipboardListFilter>,
) {
  const queryClient = useQueryClient();
  useHistoryChanges(queryClient);

  const query = useInfiniteQuery({
    queryKey: computed(
      () =>
        [
          ...clipboardItemsQueryKey,
          toValue(filter).kind,
          toValue(filter).search,
        ] as const,
    ),
    queryFn: ({ queryKey: [, kind, search], pageParam }) =>
      fetchClipboardPage({
        kind,
        search,
        cursor: pageParam,
        limit: clipboardPageSize,
      }),
    initialPageParam: undefined as ClipboardListCursor | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    // While a search narrows, the last results stay up instead of a flash of
    // "Loading"; a tab switch shows its own list, not the previous tab's
    placeholderData: (previousData, previousQuery) =>
      previousQuery?.queryKey[1] === toValue(filter).kind
        ? previousData
        : undefined,
    staleTime: clipboardCacheDuration,
    gcTime: clipboardCacheDuration,
    // the panel's show counts as a focus; the change event keeps the list fresh
    refetchOnWindowFocus: false,
  });

  const items = computed(() =>
    uniqueById(query.data.value?.pages.flatMap((page) => page.items) ?? []),
  );
  // only the first page counts; a change refetches it along with the rest
  const total = computed(
    () => query.data.value?.pages[0]?.total ?? items.value.length,
  );

  return {
    items,
    total,
    error: query.error,
    loading: query.isPending,
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => {
      if (query.hasNextPage.value && !query.isFetchingNextPage.value) {
        void query.fetchNextPage();
      }
    },
  };
}

/**
 * One item whole, for the preview: the list's copy is shown as a placeholder
 * until it loads, since a long text comes cut down with the list. Refetched
 * on every history change, so a pin shows; `isGone` once it's deleted.
 */
export function useClipboardItem(
  id: MaybeRefOrGetter<string | null>,
  placeholder: MaybeRefOrGetter<ClipboardHistoryItem | null>,
) {
  const queryClient = useQueryClient();
  useHistoryChanges(queryClient);

  const query = useQuery({
    queryKey: computed(() => [...clipboardItemQueryKey, toValue(id)] as const),
    queryFn: ({ queryKey: [, itemId] }) =>
      itemId ? fetchClipboardItem(itemId) : null,
    enabled: computed(() => toValue(id) !== null),
    placeholderData: () => toValue(placeholder) ?? undefined,
    staleTime: clipboardCacheDuration,
    gcTime: clipboardCacheDuration,
    refetchOnWindowFocus: false,
  });

  return {
    item: computed(() => query.data.value ?? null),
    isGone: computed(() => query.isSuccess.value && query.data.value === null),
  };
}

// One subscription for all of the page's queries, for as long as any is mounted
let subscriberCount = 0;
let unsubscribeFromHistory: (() => void) | undefined;
let unsubscribeFromLock: (() => void) | undefined;
// The history changed while the panel was hidden
let missedChanges = false;
/** How long showing the panel waits for a list that changed while hidden */
const catchUpWaitMs = 200;

function useHistoryChanges(queryClient: QueryClient): void {
  onMounted(() => {
    subscriberCount += 1;
    unsubscribeFromLock ??= tiny.api.on("history-secrets-locked", () => {
      // Drop cached plaintext rather than keeping it for the ordinary
      // stale-while-revalidate window, including while the panel is hidden.
      for (const queryKey of [clipboardItemsQueryKey, clipboardItemQueryKey]) {
        queryClient.removeQueries({ queryKey, type: "inactive" });
        void queryClient.resetQueries({ queryKey, type: "active" });
      }
    });
    unsubscribeFromHistory ??= tiny.api.on(clipboardHistoryChangedEvent, () => {
      // Lists on screen refetch their loaded pages; the others when next
      // shown. The panel is hidden most of the day while every copy on the
      // Mac lands here: then nothing is read until it shows (catchUpOnHistory)
      const refetchType = isPanelHidden() ? "none" : "active";
      if (refetchType === "none") missedChanges = true;
      void queryClient.invalidateQueries({
        queryKey: clipboardItemsQueryKey,
        refetchType,
      });
      void queryClient.invalidateQueries({
        queryKey: clipboardItemQueryKey,
        refetchType,
      });
    });
  });
  onUnmounted(() => {
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) {
      unsubscribeFromHistory?.();
      unsubscribeFromHistory = undefined;
      unsubscribeFromLock?.();
      unsubscribeFromLock = undefined;
    }
  });
}

/** As the panel shows: read what changed while it was hidden, waiting a
 *  moment for it so the panel rarely opens on the old list. */
export async function catchUpOnHistory(
  queryClient: QueryClient,
): Promise<void> {
  if (!missedChanges) return;
  missedChanges = false;
  const refetched = Promise.all([
    queryClient.refetchQueries({
      queryKey: clipboardItemsQueryKey,
      type: "active",
      stale: true,
    }),
    queryClient.refetchQueries({
      queryKey: clipboardItemQueryKey,
      type: "active",
      stale: true,
    }),
  ]);
  await Promise.race([
    refetched,
    new Promise((resolve) => setTimeout(resolve, catchUpWaitMs)),
  ]);
}

function uniqueById(items: ClipboardHistoryItem[]): ClipboardHistoryItem[] {
  const seen = new Set<string>();
  return items.filter((item) => !seen.has(item.id) && seen.add(item.id));
}

async function fetchClipboardPage(
  request: ClipboardListRequest,
): Promise<ClipboardListPage> {
  const result: unknown = await tiny.api.call("clipboardItems", request);
  const page = (result ?? {}) as Partial<ClipboardListPage>;
  const items = Array.isArray(page.items)
    ? page.items.filter(isClipboardHistoryItem)
    : [];
  return {
    items,
    nextCursor: page.nextCursor ?? null,
    total: typeof page.total === "number" ? page.total : null,
  };
}

/** The item with all of its text, or null once it's gone from the history. */
export async function fetchClipboardItem(
  id: string,
): Promise<ClipboardHistoryItem | null> {
  const result: unknown = await tiny.api.call("clipboardItem", { id });
  return isClipboardHistoryItem(result) ? result : null;
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
