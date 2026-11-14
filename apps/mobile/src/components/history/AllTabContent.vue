<script lang="ts" setup>
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@teneo/ui/components/context-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@teneo/ui/components/empty";
import { currentTime } from "@teneo/ui/composables/useRelativeTimeAgo";
import { computed, type ComponentPublicInstance, ref, watch } from "vue";
import AlertCircleIcon from "~icons/tabler/alert-circle";
import TextAlignLeftIcon from "~icons/tabler/align-left";
import ClipboardListIcon from "~icons/tabler/clipboard-list";
import CopyIcon from "~icons/tabler/copy";
import OpenIcon from "~icons/tabler/eye";
import FileIcon from "~icons/tabler/file";
import PaletteIcon from "~icons/tabler/palette";
import ImageIcon from "~icons/tabler/photo";
import PinIcon from "~icons/tabler/pin";
import PinOffIcon from "~icons/tabler/pinned-off";
import ShareIcon from "~icons/tabler/share";
import DeleteIcon from "~icons/tabler/trash";

import { useClient } from "../../client";
import { showCopiedNotice } from "../../composables/useCopiedNotice";
import { useBackToClose } from "../../composables/useNavigation";
import type { TabVariant } from "../../types/tabs";
import { shareItem } from "../../utils/share";
import ClipboardItemCard from "./ClipboardItemCard.vue";

const props = withDefaults(
  defineProps<{
    items: ClipboardHistoryItem[];
    tab: TabVariant;
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

const client = useClient();

interface ClipboardItemGroup {
  key: number | "pinned";
  label: string;
  items: ClipboardHistoryItem[];
}

type ListRow =
  | { type: "header"; key: string; label: string; isFirst: boolean }
  | { type: "item"; key: string; item: ClipboardHistoryItem; isFirst: boolean };

const dayInMilliseconds = 24 * 60 * 60 * 1000;
// Changes once a day, so the groups regroup at midnight, not on every tick
const todayStart = computed(() => getDayStart(currentTime.value.getTime()));

// Pinned items come first from the client
const groupedItems = computed<ClipboardItemGroup[]>(() => {
  const pinnedGroup: ClipboardItemGroup = {
    key: "pinned",
    label: "Pinned",
    items: [],
  };
  const groups = new Map<number, ClipboardItemGroup>();

  for (const item of props.items) {
    if (item.pinned) {
      pinnedGroup.items.push(item);
      continue;
    }
    const dayStart = getDayStart(item.dateCopied);
    const existingGroup = groups.get(dayStart);
    if (existingGroup) {
      existingGroup.items.push(item);
      continue;
    }
    groups.set(dayStart, {
      key: dayStart,
      label: getDayLabel(dayStart),
      items: [item],
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
    ...group.items.map((item, itemIndex) => ({
      type: "item" as const,
      key: item.id,
      item,
      isFirst: itemIndex === 0,
    })),
  ]),
);

// Only the rows on screen are in the page. Each row carries the gap above it,
// so the rows can be laid out from their measured heights alone. Sizes are in
// rem, like the text sizes, so they follow the root font size.
const headerHeight = 1.25;
const cardHeight = 6.5;
function rowGap(row: ListRow): number {
  if (row.type === "header") return row.isFirst ? 0 : 1;
  return 0.25;
}
const remInPixels = parseFloat(
  getComputedStyle(document.documentElement).fontSize,
);

const viewport = ref<HTMLElement | null>(null);

const virtualizer = useVirtualizer(
  computed(() => ({
    count: listRows.value.length,
    getScrollElement: () => viewport.value,
    estimateSize: (index: number) => {
      const row = listRows.value[index];
      if (!row) return cardHeight;
      const rems =
        rowGap(row) + (row.type === "header" ? headerHeight : cardHeight);
      return rems * remInPixels;
    },
    getItemKey: (index: number) => listRows.value[index]?.key ?? index,
    overscan: 6,
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const visibleRows = computed(() =>
  virtualRows.value.flatMap((virtualRow) => {
    const row = listRows.value[virtualRow.index];
    return row ? [{ virtualRow, row }] : [];
  }),
);

function measureRow(row: Element | ComponentPublicInstance | null): void {
  if (row instanceof Element) virtualizer.value.measureElement(row);
}

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

// A new tab starts at the top
watch(
  () => props.tab,
  () => virtualizer.value.scrollToOffset(0),
);

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

// --- the menu a long press on a card opens. One menu serves the whole list:
// the press picks which card it's for.

const menuItem = ref<ClipboardHistoryItem | null>(null);
const isMenuOpenState = ref(false);
const isMenuOpen = computed({
  get: () => isMenuOpenState.value,
  // a press between cards opens nothing
  set: (open) => (isMenuOpenState.value = open && menuItem.value !== null),
});
useBackToClose(isMenuOpenState);

function pickMenuItem(event: Event): void {
  if (isMenuOpenState.value) return;
  const card = (event.target as Element | null)?.closest("[data-item-id]");
  const id = card?.getAttribute("data-item-id");
  menuItem.value = props.items.find((item) => item.id === id) ?? null;
}

function copyMenuItem(item: ClipboardHistoryItem): void {
  void client
    .copyToClipboard(item.id)
    .then(showCopiedNotice)
    .catch(() => undefined);
}

function pinMenuItem(item: ClipboardHistoryItem): void {
  void client.setPinned(item.id, !item.pinned).catch(() => undefined);
}

function deleteMenuItem(item: ClipboardHistoryItem): void {
  void client.deleteItem(item.id).catch(() => undefined);
}
</script>

<template>
  <div ref="viewport" class="size-full overflow-y-auto overscroll-contain">
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
    <ContextMenu v-else-if="props.items.length" v-model:open="isMenuOpen">
      <ContextMenuTrigger as-child>
        <div
          class="relative w-full"
          :style="{ height: `${virtualizer.getTotalSize()}px` }"
          @pointerdown="pickMenuItem"
          @contextmenu="pickMenuItem">
          <div
            v-for="{ virtualRow, row } in visibleRows"
            :key="row.key"
            :ref="measureRow"
            :data-index="virtualRow.index"
            class="absolute inset-x-0 top-0"
            :style="{
              transform: `translateY(${virtualRow.start}px)`,
              paddingTop: `${rowGap(row)}rem`,
            }">
            <h2
              v-if="row.type === 'header'"
              class="text-foreground/50 px-1 text-xs font-medium">
              {{ row.label }}
            </h2>
            <ClipboardItemCard
              v-else
              :item-details="row.item"
              :is-active="isMenuOpen && menuItem?.id === row.item.id"
              @preview="emit('preview', $event)" />
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent v-if="menuItem" class="min-w-44">
        <ContextMenuItem @select="copyMenuItem(menuItem)">
          <CopyIcon /> Copy
        </ContextMenuItem>
        <ContextMenuItem @select="emit('preview', menuItem)">
          <OpenIcon /> Preview
        </ContextMenuItem>
        <ContextMenuItem @select="pinMenuItem(menuItem)">
          <template v-if="menuItem.pinned"><PinOffIcon /> Unpin</template>
          <template v-else><PinIcon /> Pin</template>
        </ContextMenuItem>
        <ContextMenuItem @select="shareItem(menuItem)">
          <ShareIcon /> Share
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          @select="deleteMenuItem(menuItem)">
          <DeleteIcon /> Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
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
  </div>
</template>
