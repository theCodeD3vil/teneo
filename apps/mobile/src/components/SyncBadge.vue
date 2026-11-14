<script setup lang="ts">
import { computed } from "vue";
import IconRefresh from "~icons/tabler/refresh";

import type { SyncStatus } from "../types/sync";

const props = defineProps<{
  status: SyncStatus;
}>();

const emit = defineEmits<{
  (e: "click"): void;
}>();

const label = computed(() => {
  switch (props.status.state) {
    case "connected": {
      const device = props.status.devices[0]?.name;
      return device ? `Synced • ${device}` : "Synced";
    }
    case "searching":
      return "Searching…";
    case "error":
      return "Sync error";
    case "not_paired":
      return "Not paired";
    case "off":
    default:
      return "Sync off";
  }
});

const dotColor = computed(() => {
  switch (props.status.state) {
    case "connected":
      return "bg-emerald-500";
    case "searching":
      return "bg-amber-500 animate-pulse";
    case "error":
      return "bg-destructive";
    case "not_paired":
    case "off":
    default:
      return "bg-muted-foreground/40";
  }
});
</script>

<template>
  <button
    type="button"
    class="bg-muted/70 hover:bg-muted active:bg-muted/90 flex min-h-11 items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium transition-colors"
    :title="label"
    @click="emit('click')">
    <span class="size-2 rounded-full" :class="dotColor" />
    <span class="text-muted-foreground max-w-[140px] truncate">{{
      label
    }}</span>
    <IconRefresh
      v-if="status.state === 'searching'"
      class="text-muted-foreground size-3 animate-spin" />
  </button>
</template>
