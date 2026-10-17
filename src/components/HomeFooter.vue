<script lang="ts" setup>
import CommandIcon from "~icons/hugeicons/command";
import Settings from "~icons/hugeicons/settings-01";
import SpaceIcon from "~icons/hugeicons/space";

import Button from "./ui/button/Button.vue";
import Kbd from "./ui/kbd/Kbd.vue";
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

    <!-- commands -->
    <div class="text-foreground/70 flex gap-x-3 text-xs">
      <Kbd class="bg-foreground/10"> <SpaceIcon /> Space </Kbd> to preview
      <Kbd class="bg-foreground/10"> <CommandIcon /> V </Kbd>
      to copy
    </div>

    <!-- settings button -->
    <Button
      variant="ghost"
      size="icon"
      class="hover:bg-foreground/5! text-foreground/70 hover:text-foreground">
      <Settings />
    </Button>
  </div>
</template>
