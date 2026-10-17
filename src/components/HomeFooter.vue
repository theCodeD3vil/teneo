<script lang="ts" setup>
import Settings from "~icons/hugeicons/settings-01";

import Button from "./ui/button/Button.vue";
const props = defineProps<{
  clipboardItemsCount: number;
}>();
</script>
<template>
  <div class="flex items-center justify-between gap-4 p-1">
    <!-- items count -->
    <span class="text-foreground/60 text-xs">
      {{ clipboardItemsCount }} items
    </span>
    <Button
      variant="ghost"
      size="icon"
      class="hover:bg-foreground/5! text-foreground/70 hover:text-foreground">
      <Settings />
    </Button>
  </div>
</template>
