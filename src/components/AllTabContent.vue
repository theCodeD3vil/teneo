<script lang="ts" setup>
import {
  computed,
  onUnmounted,
  ref,
  watch,
  type ComponentPublicInstance,
} from "vue";
import AlertCircleIcon from "~icons/hugeicons/alert-circle";
import ClipboardListIcon from "~icons/hugeicons/clipboard-list";
import FileIcon from "~icons/hugeicons/file-01";
import ImageIcon from "~icons/hugeicons/image-01";
import PaletteIcon from "~icons/hugeicons/palette";
import TextAlignLeftIcon from "~icons/hugeicons/text-align-left";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ClipboardHistoryItem, TabVariant } from "@/types/clipboard";

import ClipboardItemCard from "./ClipboardItemCard.vue";

const props = withDefaults(
  defineProps<{
    items: ClipboardHistoryItem[];
    tab: TabVariant;
    activeItemId: string | null;
    loading: boolean;
    error: Error | null;
    emptyMessage?: string;
  }>(),
  { emptyMessage: "No clipboard history yet." },
);

type ClipboardItemCardAction =
  | "copyAndHideWindow"
  | "pasteAndHideWindow"
  | "previewItem"
  | "deleteItem"
  | "pinItem";

type ClipboardItemCardReference = ComponentPublicInstance &
  Record<ClipboardItemCardAction, () => boolean>;

interface ClipboardItemGroup {
  key: number | "pinned";
  label: string;
  items: Array<{ item: ClipboardHistoryItem; index: number }>;
}

const cardReferences = new Map<string, ClipboardItemCardReference>();
const dayInMilliseconds = 24 * 60 * 60 * 1000;

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

// Headers and cards in one flat keyed list: a card that moves to another group
// keeps its instance (and loaded preview), so TransitionGroup can slide it there
const listRows = computed(() =>
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

// Only pinning or unpinning slides cards; tab switches, searches and new copies
// change the list instantly, as before
const pinMoveDuration = 300;
const isAnimatingPinMove = ref(false);
let pinMoveTimeout: ReturnType<typeof setTimeout> | undefined;

watch(
  () => props.items,
  (items, previousItems) => {
    const wasPinned = new Map(
      previousItems.map((item) => [item.id, item.pinned]),
    );
    const pinChanged = items.some(
      (item) =>
        wasPinned.has(item.id) && wasPinned.get(item.id) !== item.pinned,
    );
    if (!pinChanged) return;

    isAnimatingPinMove.value = true;
    clearTimeout(pinMoveTimeout);
    pinMoveTimeout = setTimeout(() => {
      isAnimatingPinMove.value = false;
    }, pinMoveDuration);
  },
);

onUnmounted(() => clearTimeout(pinMoveTimeout));

function getDayStart(timestamp: number): number {
  const date = new Date(timestamp);
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  ).getTime();
}

function getDayLabel(dayStart: number): string {
  const todayStart = getDayStart(Date.now());
  const daysAgo = Math.round((todayStart - dayStart) / dayInMilliseconds);

  if (daysAgo === 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  return `${daysAgo} days ago`;
}

function setCardReference(
  itemId: string,
  card: Element | ComponentPublicInstance | null,
): void {
  if (isClipboardItemCardReference(card)) {
    cardReferences.set(itemId, card);
  } else {
    cardReferences.delete(itemId);
  }
}

function isClipboardItemCardReference(
  card: Element | ComponentPublicInstance | null,
): card is ClipboardItemCardReference {
  return (
    card !== null &&
    "copyAndHideWindow" in card &&
    typeof card.copyAndHideWindow === "function"
  );
}

function runCardAction(
  itemId: string | null,
  action: ClipboardItemCardAction,
): boolean {
  if (!itemId) return false;
  return cardReferences.get(itemId)?.[action]() ?? false;
}

defineExpose({
  copyActiveItem: (itemId: string | null) =>
    runCardAction(itemId, "copyAndHideWindow"),
  pasteActiveItem: (itemId: string | null) =>
    runCardAction(itemId, "pasteAndHideWindow"),
  previewActiveItem: (itemId: string | null) =>
    runCardAction(itemId, "previewItem"),
  deleteActiveItem: (itemId: string | null) =>
    runCardAction(itemId, "deleteItem"),
  pinActiveItem: (itemId: string | null) => runCardAction(itemId, "pinItem"),
});
</script>
<template>
  <ScrollArea class="scroll-fade size-full scrollbar-none! rounded-md">
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
    <!-- each card awaits its source-app icon in setup, so it only renders inside Suspense -->
    <Suspense v-else>
      <div>
        <!-- css=false: items appear and disappear instantly; only moves animate.
             transition-transform! beats the card's own transition property. -->
        <TransitionGroup
          v-if="props.items.length"
          tag="div"
          class="flex flex-col gap-2"
          :css="false"
          :move-class="
            isAnimatingPinMove
              ? 'transition-transform! duration-300 ease-out'
              : ''
          ">
          <template v-for="row in listRows" :key="row.key">
            <h2
              v-if="row.type === 'header'"
              :class="[
                'text-foreground/50 px-1 text-xs font-medium',
                !row.isFirst && 'mt-3',
              ]">
              {{ row.label }}
            </h2>
            <ClipboardItemCard
              v-else
              :ref="(card) => setCardReference(row.item.id, card)"
              :class="!row.isFirst && 'mt-2'"
              :item-details="row.item"
              :is-active="row.item.id === props.activeItemId"
              :quick-paste-index="row.index + 1"
              :supports-quick-paste="row.index + 1 < 10" />
          </template>
        </TransitionGroup>
        <Empty v-else>
          <EmptyHeader>
            <EmptyMedia
              variant="icon"
              class="bg-foreground/5 text-foreground/70">
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
    </Suspense>
  </ScrollArea>
</template>
