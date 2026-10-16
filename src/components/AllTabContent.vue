<script lang="ts" setup>
import { ScrollArea } from "@/components/ui/scroll-area";
import type { ClipboardHistoryItem } from "@/types/clipboard";

import ClipboardItemCard from "./ClipboardItemCard.vue";

const props = withDefaults(
  defineProps<{
    items: ClipboardHistoryItem[];
    loading: boolean;
    error: Error | null;
    emptyMessage?: string;
  }>(),
  { emptyMessage: "No clipboard history yet." },
);
</script>
<template>
  <ScrollArea class="scroll-fade size-full scrollbar-none! rounded-md">
    <p v-if="props.loading" class="text-foreground/50 p-3 text-sm">
      Loading clipboard history…
    </p>
    <p v-else-if="props.error" class="text-destructive p-3 text-sm">
      Could not load clipboard history.
    </p>
    <!-- each card awaits its source-app icon in setup, so it only renders inside Suspense -->
    <Suspense v-else>
      <div>
        <div v-if="props.items.length" class="flex flex-col gap-4">
          <ClipboardItemCard
            v-for="(item, index) in props.items"
            :key="item.id"
            :item-details="item"
            :quick-paste-index="index + 1"
            :supports-quick-paste="index + 1 < 10" />
        </div>
        <p v-else class="text-foreground/50 p-3 text-sm">
          {{ props.emptyMessage }}
        </p>
      </div>
    </Suspense>
  </ScrollArea>
</template>
