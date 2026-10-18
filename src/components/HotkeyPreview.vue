<script setup lang="ts">
import { computed } from "vue";
import CommandIcon from "~icons/hugeicons/command";
import OptionIcon from "~icons/hugeicons/option";

import type { HotkeyPreviewKey, HotkeyProgress } from "@/constants/hotkeys";

import Kbd from "./ui/kbd/Kbd.vue";

const props = defineProps<{
  progress: HotkeyProgress;
}>();

const colorClasses = computed(() =>
  props.progress.state === "complete"
    ? "bg-success/15! text-success"
    : "bg-warning/15! text-warning",
);

function getKeyLabel(key: HotkeyPreviewKey): string {
  if (key.type === "key") return key.value;

  switch (key.value) {
    case "control":
      return "Ctrl";
    case "shift":
      return "Shift";
    case "option":
      return "Option";
    case "command":
      return "Command";
  }
}
</script>

<template>
  <div class="flex items-center gap-1 text-xs">
    <TransitionGroup
      tag="div"
      class="flex items-center gap-1"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-x-1 opacity-0 scale-95"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="-translate-x-1 opacity-0 scale-95">
      <Kbd
        v-for="key in progress.keys"
        :key="`${key.type}-${key.value}`"
        :class="[
          'transition-[background-color,color,transform] duration-200 ease-out',
          colorClasses,
        ]">
        <CommandIcon
          v-if="key.type === 'modifier' && key.value === 'command'" />
        <OptionIcon
          v-else-if="key.type === 'modifier' && key.value === 'option'" />
        <span v-else>{{ getKeyLabel(key) }}</span>
      </Kbd>
    </TransitionGroup>
  </div>
</template>
