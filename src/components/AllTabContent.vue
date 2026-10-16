<script lang="ts" setup>
import { ScrollArea } from "@/components/ui/scroll-area";
import { useClipboard } from "@/composables/useClipboard";

import ClipboardItemCard from "./ClipboardItemCard.vue";

const { clipboardItems, error, loading } = useClipboard();
</script>
<template>
  <ScrollArea class="scroll-fade size-full scrollbar-none! rounded-md">
    <p v-if="loading" class="text-foreground/50 p-3 text-sm">
      Loading clipboard history…
    </p>
    <p v-else-if="error" class="text-destructive p-3 text-sm">
      Could not load clipboard history.
    </p>
    <!-- each card awaits its source-app icon in setup, so it only renders inside Suspense -->
    <Suspense v-else>
      <div>
        <div v-if="clipboardItems.length" class="flex flex-col gap-4">
          <ClipboardItemCard
            v-for="(item, index) in clipboardItems"
            :key="item.id"
            :item-details="item"
            :quick-paste-index="index + 1"
            :supports-quick-paste="index + 1 < 10" />
        </div>
        <p v-else class="text-foreground/50 p-3 text-sm">
          No clipboard history yet.
        </p>
      </div>
    </Suspense>
  </ScrollArea>
</template>
