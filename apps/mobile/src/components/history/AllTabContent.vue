<script lang="ts" setup>
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@teneo/ui/components/empty";
import { currentTime } from "@teneo/ui/composables/useRelativeTimeAgo";
import { computed, type ComponentPublicInstance, ref, watch } from "vue";

import type { TabVariant } from "../../types/tabs";
import EmptyIllustration from "../illustrations/EmptyIllustration.vue";
import ClipboardItemCard from "./ClipboardItemCard.vue";
import ItemActionSheet from "./ItemActionSheet.vue";

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
    /** what the list is filtered by; nothing matching it is told apart
     *  from nothing copied */
    searchQuery?: string;
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

// --- the action sheet a long press on a card opens. One sheet serves the
// whole list: the press picks which card it's for. It keeps its item after
// closing, so the sheet still has content while it slides away.

const menuItem = ref<ClipboardHistoryItem | null>(null);
const isMenuOpen = ref(false);

function openMenu(target: EventTarget | null): void {
  const card = (target as Element | null)?.closest("[data-item-id]");
  const id = card?.getAttribute("data-item-id");
  const item = props.items.find((listed) => listed.id === id);
  if (!item) return;
  menuItem.value = item;
  isMenuOpen.value = true;
}

const longPressDelay = 450; // ms
// how far the finger may drift during the press; further is a scroll
const longPressSlop = 8; // px, under the tab swipe's axis lock
let press: {
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
} | null = null;
let lastPointerType = "";
// the finger lifting after a long press isn't a tap: it mustn't copy
let isLongPressRelease = false;

function startPress(event: PointerEvent): void {
  lastPointerType = event.pointerType;
  isLongPressRelease = false;
  cancelPress();
  // a mouse opens the sheet with a right-click instead
  if (event.pointerType === "mouse") return;
  const target = event.target;
  press = {
    x: event.clientX,
    y: event.clientY,
    timer: setTimeout(() => {
      press = null;
      isLongPressRelease = true;
      openMenu(target);
    }, longPressDelay),
  };
}

function movePress(event: PointerEvent): void {
  if (!press) return;
  const distance = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  if (distance > longPressSlop) cancelPress();
}

function cancelPress(): void {
  if (press) clearTimeout(press.timer);
  press = null;
}

function swallowLongPressClick(event: MouseEvent): void {
  if (!isLongPressRelease) return;
  isLongPressRelease = false;
  event.stopPropagation();
  event.preventDefault();
}

// Android fires this on a long press too; the timer above handles touch
function handleContextMenu(event: MouseEvent): void {
  event.preventDefault();
  if (lastPointerType === "mouse") openMenu(event.target);
}
</script>

<template>
  <div
    ref="viewport"
    class="size-full touch-pan-y overflow-y-auto overscroll-contain">
    <p v-if="props.loading" class="text-foreground/50 p-3 text-sm">
      Loading clipboard history…
    </p>
    <Empty v-else-if="props.error">
      <EmptyHeader>
        <EmptyMedia>
          <EmptyIllustration kind="error" class="w-44" />
        </EmptyMedia>
        <EmptyTitle class="text-foreground/70">
          Could not load clipboard history.
        </EmptyTitle>
        <EmptyDescription class="text-foreground/50">
          Try again in a moment.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <template v-else-if="props.items.length">
      <div
        class="relative w-full"
        :style="{ height: `${virtualizer.getTotalSize()}px` }"
        @pointerdown="startPress"
        @pointermove="movePress"
        @pointerup="cancelPress"
        @pointercancel="cancelPress"
        @click.capture="swallowLongPressClick"
        @contextmenu="handleContextMenu">
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
      <ItemActionSheet
        v-model:open="isMenuOpen"
        :item="menuItem"
        @preview="emit('preview', $event)" />
    </template>
    <Empty v-else-if="props.searchQuery">
      <EmptyHeader>
        <EmptyMedia>
          <EmptyIllustration kind="search" class="w-44" />
        </EmptyMedia>
        <EmptyTitle class="text-foreground/70">
          Nothing matches “{{ props.searchQuery }}”
        </EmptyTitle>
        <EmptyDescription class="text-foreground/50">
          Try other words, or look in another tab.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <Empty v-else>
      <EmptyHeader>
        <EmptyMedia>
          <EmptyIllustration :kind="props.tab" class="w-44" />
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
