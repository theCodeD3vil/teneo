<script lang="ts" setup>
import type { ComponentPublicInstance } from "vue";
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

type ClipboardItemCardReference = ComponentPublicInstance & {
  copyAndHideWindow: () => boolean;
};

const cardReferences = new Map<string, ClipboardItemCardReference>();

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

function copyActiveItem(itemId: string | null): boolean {
  if (!itemId) return false;
  return cardReferences.get(itemId)?.copyAndHideWindow() ?? false;
}

defineExpose({ copyActiveItem });
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
        <div v-if="props.items.length" class="flex flex-col gap-4">
          <ClipboardItemCard
            v-for="(item, index) in props.items"
            :key="item.id"
            :ref="(card) => setCardReference(item.id, card)"
            :item-details="item"
            :is-active="item.id === props.activeItemId"
            :quick-paste-index="index + 1"
            :supports-quick-paste="index + 1 < 10" />
        </div>
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
