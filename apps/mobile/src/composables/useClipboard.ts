import type {
  ClipboardHistoryItem,
  ClipboardListCursor,
  ClipboardListRequest,
} from "@teneo/shared/types/clipboard";
import {
  computed,
  type MaybeRefOrGetter,
  onScopeDispose,
  ref,
  shallowRef,
  toValue,
  watch,
} from "vue";

import { useClient } from "../client";

/** Items per page: a screen's worth and some to scroll into before the next loads */
export const clipboardPageSize = 50;

export type ClipboardListFilter = Pick<ClipboardListRequest, "kind" | "search">;

/**
 * The history for one tab and search, a page at a time. A change to the
 * history reloads what's loaded, so a copy, pin or delete shows at once.
 */
export function useClipboardList(
  filter: MaybeRefOrGetter<ClipboardListFilter>,
) {
  const client = useClient();
  const items = shallowRef<ClipboardHistoryItem[]>([]);
  const total = ref(0);
  const nextCursor = shallowRef<ClipboardListCursor | null>(null);
  const loading = ref(true);
  const loadingMore = ref(false);
  const error = shallowRef<Error | null>(null);
  // a newer load makes an older one's answer stale
  let loadId = 0;

  async function load(limit = clipboardPageSize): Promise<void> {
    const id = ++loadId;
    const { kind, search } = toValue(filter);
    try {
      const page = await client.listItems({ kind, search, limit });
      if (id !== loadId) return;
      items.value = page.items;
      total.value = page.total ?? page.items.length;
      nextCursor.value = page.nextCursor;
      error.value = null;
    } catch (caught) {
      if (id === loadId) error.value = toError(caught);
    } finally {
      if (id === loadId) loading.value = false;
    }
  }

  async function loadMore(): Promise<void> {
    const cursor = nextCursor.value;
    if (!cursor || loadingMore.value) return;
    loadingMore.value = true;
    const id = loadId;
    const { kind, search } = toValue(filter);
    try {
      const page = await client.listItems({
        kind,
        search,
        cursor,
        limit: clipboardPageSize,
      });
      if (id !== loadId) return;
      const seen = new Set(items.value.map((item) => item.id));
      items.value = [
        ...items.value,
        ...page.items.filter((item) => !seen.has(item.id)),
      ];
      nextCursor.value = page.nextCursor;
    } catch (caught) {
      if (id === loadId) error.value = toError(caught);
    } finally {
      loadingMore.value = false;
    }
  }

  // While a search narrows, the last results stay up instead of a flash of
  // "Loading"; a tab switch shows its own list, not the previous tab's
  watch(
    () => toValue(filter),
    (next, previous) => {
      if (!previous || next.kind !== previous.kind) {
        loading.value = true;
        items.value = [];
      }
      void load();
    },
    { immediate: true, deep: true },
  );

  const unsubscribe = client.onHistoryChanged(() => {
    void load(Math.max(clipboardPageSize, items.value.length));
  });
  onScopeDispose(unsubscribe);

  return {
    items,
    total,
    error,
    loading,
    hasMore: computed(() => nextCursor.value !== null),
    loadingMore,
    loadMore,
  };
}

/**
 * One item whole, for the preview: the list carries only the start of a long
 * text. Reloaded on every history change, so a pin shows; `isGone` once it's
 * deleted.
 */
export function useClipboardItem(id: MaybeRefOrGetter<string | null>) {
  const client = useClient();
  const item = shallowRef<ClipboardHistoryItem | null>(null);
  const isGone = ref(false);
  let loadId = 0;

  async function load(): Promise<void> {
    const itemId = toValue(id);
    const current = ++loadId;
    if (!itemId) {
      item.value = null;
      return;
    }
    const loaded = await client.getItem(itemId);
    if (current !== loadId) return;
    item.value = loaded;
    isGone.value = loaded === null;
  }

  watch(() => toValue(id), load, { immediate: true });
  onScopeDispose(client.onHistoryChanged(() => void load()));

  return { item, isGone };
}

function toError(caught: unknown): Error {
  return caught instanceof Error ? caught : new Error(String(caught));
}
