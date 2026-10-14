<script lang="ts" setup>
import { ScrollArea } from "@/components/ui/scroll-area";
import { mockAllItems } from "@/mocks/clipboard";

import ClipboardItemCard from "./ClipboardItemCard.vue";
const clipboardItems = mockAllItems;
</script>
<template>
  <ScrollArea class="scroll-fade size-full scrollbar-none! rounded-md">
    <!-- each card awaits its source-app icon in setup, so it only renders inside Suspense -->
    <Suspense>
      <div class="flex flex-col gap-4">
        <ClipboardItemCard
          v-for="(item, index) in clipboardItems"
          :key="index"
          :item-details="item" />
      </div>
    </Suspense>
  </ScrollArea>
</template>
