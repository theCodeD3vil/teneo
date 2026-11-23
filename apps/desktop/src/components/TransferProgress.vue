<script setup lang="ts">
import { formatFileSize } from "@teneo/ui/utils/file-size";
import { computed } from "vue";

const props = defineProps<{
  label: string;
  progressLabel: string;
  received?: number;
  total?: number | null;
  finalizing?: boolean;
}>();

const percent = computed(() => {
  if (props.finalizing || !props.total || props.received === undefined)
    return null;
  return Math.min(100, (props.received / props.total) * 100);
});
</script>

<template>
  <div class="flex w-full flex-col justify-center gap-y-2">
    <div
      class="text-foreground/60 flex flex-wrap justify-between gap-x-3 text-xs">
      <span role="status">{{ label }}</span>
      <span v-if="received !== undefined && !finalizing" class="tabular-nums">
        {{ formatFileSize(received) }}
        <template v-if="total"> of {{ formatFileSize(total) }} </template>
      </span>
    </div>
    <div
      role="progressbar"
      :aria-label="progressLabel"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="percent ?? undefined"
      class="bg-foreground/10 dark:bg-foreground/15 h-1.5 overflow-hidden rounded-full">
      <div
        v-if="percent !== null"
        class="bg-primary h-full rounded-full motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out"
        :style="{ width: `${percent}%` }" />
      <div v-else class="indeterminate bg-primary h-full w-2/5 rounded-full" />
    </div>
  </div>
</template>

<style scoped>
.indeterminate {
  transform: translateX(75%);
}
@media (prefers-reduced-motion: no-preference) {
  .indeterminate {
    animation: sweep 1.4s ease-in-out infinite;
  }
}
@keyframes sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
</style>
