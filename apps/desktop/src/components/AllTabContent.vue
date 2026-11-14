<script lang="ts" setup>
import { useVirtualizer } from "@tanstack/vue-virtual";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@teneo/ui/components/empty";
import { ScrollArea } from "@teneo/ui/components/scroll-area";
import { currentTime } from "@teneo/ui/composables/useRelativeTimeAgo";
import {
  computed,
  type ComponentPublicInstance,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import AlertCircleIcon from "~icons/tabler/alert-circle";
import TextAlignLeftIcon from "~icons/tabler/align-left";
import ClipboardListIcon from "~icons/tabler/clipboard-list";
import FileIcon from "~icons/tabler/file";
import PaletteIcon from "~icons/tabler/palette";
import ImageIcon from "~icons/tabler/photo";

import { getPreviewPath, useItemPreviews } from "@/composables/useItemPreviews";
import type { QuickCopyItemNumber } from "@/constants/hotkeys";
import type { ClipboardHistoryItem, TabVariant } from "@/types/clipboard";
import { getClipboardData } from "@/utils/clipboard-items";
import { copyItemToClipboard } from "@/utils/copy-item";
import { resetPanelEvent } from "@/utils/panel-reset";

import ClipboardItemCard from "./ClipboardItemCard.vue";

const props = withDefaults(
  defineProps<{
    items: ClipboardHistoryItem[];
    tab: TabVariant;
    activeItemId: string | null;
    loading: boolean;
    error: Error | null;
    /** there are items after the last one loaded */
    hasMore?: boolean;
    loadingMore?: boolean;
    emptyMessage?: string;
  }>(),
  { emptyMessage: "No clipboard history yet." },
);

const emit = defineEmits<{
  (e: "preview", item: ClipboardHistoryItem): void;
  /** the list is near its end: load the next page */
  (e: "load-more"): void;
}>();

interface ClipboardItemGroup {
  key: number | "pinned";
  label: string;
  items: Array<{ item: ClipboardHistoryItem; index: number }>;
}

type ListRow =
  | { type: "header"; key: string; label: string; isFirst: boolean }
  | {
      type: "item";
      key: string;
      item: ClipboardHistoryItem;
      index: number;
      isFirst: boolean;
    };

const dayInMilliseconds = 24 * 60 * 60 * 1000;
// Changes once a day, so the groups below regroup at midnight, not on every tick
const todayStart = computed(() => getDayStart(currentTime.value.getTime()));

// Pinned items come first from the backend, so they also get the first ⌘ numbers
const groupedItems = computed<ClipboardItemGroup[]>(() => {
  const pinnedGroup: ClipboardItemGroup = {
    key: "pinned",
    label: "Pinned",
    items: [],
  };
  const groups = new Map<number, ClipboardItemGroup>();

  for (const [index, item] of props.items.entries()) {
    if (item.pinned) {
      pinnedGroup.items.push({ item, index });
      continue;
    }

    const dayStart = getDayStart(item.dateCopied);
    const existingGroup = groups.get(dayStart);

    if (existingGroup) {
      existingGroup.items.push({ item, index });
      continue;
    }

    groups.set(dayStart, {
      key: dayStart,
      label: getDayLabel(dayStart),
      items: [{ item, index }],
    });
  }

  const dayGroups = [...groups.values()].sort(
    (first, second) => Number(second.key) - Number(first.key),
  );
  return pinnedGroup.items.length ? [pinnedGroup, ...dayGroups] : dayGroups;
});

// Headers and cards in one flat list, so the rows on screen can be picked by index
const listRows = computed<ListRow[]>(() =>
  groupedItems.value.flatMap((group, groupIndex) => [
    {
      type: "header" as const,
      key: `group-${group.key}`,
      label: group.label,
      isFirst: groupIndex === 0,
    },
    ...group.items.map(({ item, index }, itemIndex) => ({
      type: "item" as const,
      key: item.id,
      item,
      index,
      isFirst: itemIndex === 0,
    })),
  ]),
);

// Only the rows on screen are in the page: a history of thousands of items
// costs no more than one of a dozen. Each row carries the gap above it, so
// the rows can be laid out from their measured heights alone.
const headerHeight = 16;
const cardHeight = 60;
function rowGap(row: ListRow): number {
  if (row.type === "header") return row.isFirst ? 0 : 20;
  return row.isFirst ? 8 : 16;
}

const scrollArea = ref<InstanceType<typeof ScrollArea> | null>(null);
const viewport = ref<HTMLElement | null>(null);
onMounted(() => {
  viewport.value =
    scrollArea.value?.$el.querySelector("[data-slot=scroll-area-viewport]") ??
    null;
});

const virtualizer = useVirtualizer(
  computed(() => ({
    count: listRows.value.length,
    getScrollElement: () => viewport.value,
    estimateSize: (index: number) => {
      const row = listRows.value[index];
      if (!row) return cardHeight;
      return rowGap(row) + (row.type === "header" ? headerHeight : cardHeight);
    },
    getItemKey: (index: number) => listRows.value[index]?.key ?? index,
    overscan: 6,
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());
// each row on screen with its place, so the template can tell the two apart
const visibleRows = computed(() =>
  virtualRows.value.flatMap((virtualRow) => {
    const row = listRows.value[virtualRow.index];
    return row ? [{ virtualRow, row }] : [];
  }),
);

function measureRow(row: Element | ComponentPublicInstance | null): void {
  if (row instanceof Element) virtualizer.value.measureElement(row);
}

// Previews, icons and link icons only for the cards on screen, and nothing
// new fetched while the list is scrolling
const visibleItems = computed(() =>
  visibleRows.value.flatMap(({ row }) =>
    row.type === "item" ? [row.item] : [],
  ),
);
const { sourceAppIconUrl, filePreview, linkPreviewUrl } = useItemPreviews(
  visibleItems,
  () => virtualizer.value.isScrolling,
);

// The selected card is scrolled into view; at the top of its group, its
// header comes along so the group is named
watch(
  () => props.activeItemId,
  (activeItemId) => {
    if (!activeItemId) return;
    const index = listRows.value.findIndex(
      (row) => row.type === "item" && row.item.id === activeItemId,
    );
    if (index < 0) return;
    const header = listRows.value[index - 1]?.type === "header";
    virtualizer.value.scrollToIndex(header ? index - 1 : index, {
      align: "auto",
    });
  },
  { flush: "post" },
);

// Nearing the last loaded rows, ask for the next page
const loadMoreThreshold = 10;
watch(virtualRows, (rows) => {
  const lastRow = rows.at(-1);
  if (
    lastRow &&
    props.hasMore &&
    !props.loadingMore &&
    lastRow.index >= listRows.value.length - loadMoreThreshold
  ) {
    emit("load-more");
  }
});

// The panel comes back at the top of the list
function scrollToTop(): void {
  virtualizer.value.scrollToOffset(0);
}
onMounted(() => window.addEventListener(resetPanelEvent, scrollToTop));
onUnmounted(() => window.removeEventListener(resetPanelEvent, scrollToTop));

function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getDayLabel(dayStart: number): string {
  const daysAgo = Math.round((todayStart.value - dayStart) / dayInMilliseconds);

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}

// The keys act on items by id, not through their cards: the card for an item
// further down, or for ⌘1 while scrolled down, isn't in the page
function findItem(itemId: string | null): ClipboardHistoryItem | null {
  return props.items.find((item) => item.id === itemId) ?? null;
}

// an image or file that was moved or deleted since can't be copied
function isPreviewMissing(item: ClipboardHistoryItem): boolean {
  if (item.kind !== "image" && item.kind !== "files") return false;
  return !getPreviewPath(item) || filePreview(item)?.isMissing === true;
}

function copyItem(itemId: string | null, paste: boolean): boolean {
  const item = findItem(itemId);
  if (!item || isPreviewMissing(item) || !getClipboardData(item)) return false;
  void copyItemToClipboard(item, { hideWindow: true, paste }).catch(
    () => undefined,
  );
  return true;
}

// Soft delete: the history refreshes once the backend reports the change
function deleteItem(itemId: string | null): boolean {
  if (!itemId) return false;
  void tiny.api
    .call("deleteClipboardItem", { id: itemId })
    .catch(() => undefined);
  return true;
}

// Toggles: P unpins an already pinned item
function pinItem(itemId: string | null): boolean {
  const item = findItem(itemId);
  if (!item) return false;
  void tiny.api
    .call("pinClipboardItem", { id: item.id, pinned: !item.pinned })
    .catch(() => undefined);
  return true;
}

defineExpose({
  copyActiveItem: (itemId: string | null) => copyItem(itemId, false),
  pasteActiveItem: (itemId: string | null) => copyItem(itemId, true),
  deleteActiveItem: deleteItem,
  pinActiveItem: pinItem,
  copyItemByNumber: (itemNumber: QuickCopyItemNumber) =>
    copyItem(props.items[itemNumber - 1]?.id ?? null, false),
});
</script>
<template>
  <ScrollArea
    ref="scrollArea"
    class="scroll-fade size-full scrollbar-none! rounded-md">
    <p v-if="props.loading" class="text-foreground/50 p-3 text-sm">
      Loading clipboard history…
    </p>
    <Empty v-else-if="props.error">
      <EmptyHeader>
        <EmptyMedia variant="icon" class="bg-destructive/10 text-destructive">
          <AlertCircleIcon />
        </EmptyMedia>
        <EmptyTitle class="text-foreground/70">
          Could not load clipboard history.
        </EmptyTitle>
        <EmptyDescription class="text-foreground/50">
          Try again in a moment.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <div
      v-else-if="props.items.length"
      class="relative w-full"
      :style="{ height: `${virtualizer.getTotalSize()}px` }">
      <div
        v-for="{ virtualRow, row } in visibleRows"
        :key="row.key"
        :ref="measureRow"
        :data-index="virtualRow.index"
        class="absolute inset-x-0 top-0"
        :style="{
          transform: `translateY(${virtualRow.start}px)`,
          paddingTop: `${rowGap(row)}px`,
        }">
        <h2
          v-if="row.type === 'header'"
          class="text-foreground/50 px-1 text-xs font-medium">
          {{ row.label }}
        </h2>
        <ClipboardItemCard
          v-else
          :item-details="row.item"
          :source-app-icon-url="sourceAppIconUrl(row.item)"
          :file-preview="filePreview(row.item)"
          :link-preview-url="linkPreviewUrl(row.item)"
          :is-active="row.item.id === props.activeItemId"
          :quick-paste-index="row.index + 1"
          :supports-quick-paste="row.index + 1 < 10"
          @preview="emit('preview', $event)" />
      </div>
    </div>
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia variant="icon" class="bg-foreground/5 text-foreground/70">
          <ImageIcon v-if="props.tab === 'image'" />
          <FileIcon v-else-if="props.tab === 'files'" />
          <PaletteIcon v-else-if="props.tab === 'color'" />
          <TextAlignLeftIcon v-else-if="props.tab === 'text'" />
          <ClipboardListIcon v-else />
        </EmptyMedia>
        <EmptyTitle class="text-foreground/70">
          {{ props.emptyMessage }}
        </EmptyTitle>
        <EmptyDescription class="text-foreground/50">
          Copy something to see it here.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  </ScrollArea>
</template>
