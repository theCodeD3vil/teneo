<script setup lang="ts">
import { computed } from "vue";

/** How much of an update has been downloaded, as a bar */
const props = defineProps<{
  received: number;
  size: number;
}>();

const fraction = computed(() =>
  props.size > 0 ? Math.min(Math.max(props.received / props.size, 0), 1) : 0,
);
</script>

<template>
  <div
    class="bg-muted h-[0.625rem] overflow-hidden rounded-full"
    role="progressbar"
    aria-label="Download progress"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.floor(fraction * 100)">
    <!-- scaled, not resized, so each step is the compositor's work -->
    <div
      class="bg-primary size-full origin-left rounded-full transition-transform duration-200 ease-out"
      :style="{ transform: `scaleX(${fraction})` }" />
  </div>
</template>
