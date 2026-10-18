<script lang="ts" setup>
import CommandIcon from "~icons/hugeicons/command";
import Settings from "~icons/hugeicons/settings-01";
import SpaceIcon from "~icons/hugeicons/space";

import { useHotkeyPreview } from "@/composables/useHotkeyPreview";

import HotkeyPreview from "./HotkeyPreview.vue";
import Button from "./ui/button/Button.vue";
import Kbd from "./ui/kbd/Kbd.vue";

defineProps<{
  clipboardItemsCount: number;
}>();

const { hotkeyProgress } = useHotkeyPreview();

function openSettings(): void {
  void tiny.api.call("openSettings");
}
</script>
<template>
  <div class="flex items-center justify-between gap-4 p-1">
    <!-- items count -->
    <span class="text-foreground/60 text-xs">
      {{ clipboardItemsCount }} items
    </span>

    <!-- commands -->
    <Transition
      mode="out-in"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-y-1 opacity-0 scale-95"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="-translate-y-1 opacity-0 scale-95">
      <HotkeyPreview v-if="hotkeyProgress" :progress="hotkeyProgress" />
      <div v-else class="text-foreground/70 flex items-center gap-x-3 text-xs">
        <div class="flex items-center gap-1">
          <Kbd class="bg-foreground/10"> <SpaceIcon /> Space </Kbd>
          to preview
        </div>
        <div class="flex items-center gap-1">
          <Kbd class="bg-foreground/10"> <CommandIcon /> V </Kbd>
          to paste
        </div>
        <div class="flex items-center gap-1">
          <Kbd class="bg-foreground/10"> <CommandIcon /> / </Kbd>
          to search
        </div>
      </div>
    </Transition>

    <!-- settings button -->
    <Button
      variant="ghost"
      size="icon"
      class="hover:bg-foreground/5! text-foreground/70 hover:text-foreground"
      @click="openSettings">
      <Settings />
    </Button>
  </div>
</template>
