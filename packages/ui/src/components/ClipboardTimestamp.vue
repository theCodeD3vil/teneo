<script setup lang="ts">
import { computed } from "vue";

import { useRelativeTimeAgo } from "../composables/useRelativeTimeAgo";

const props = defineProps<{ timestamp: number }>();
const relative = useRelativeTimeAgo(() => props.timestamp);
const date = computed(() => new Date(props.timestamp));
const iso = computed(() =>
  Number.isFinite(date.value.getTime()) ? date.value.toISOString() : undefined,
);
const fullDate = computed(() => (iso.value ? date.value.toLocaleString() : undefined));
</script>

<template>
  <!-- Use a typical maximum-width label to size the slot, not the live text. -->
  <time
    :datetime="iso"
    :title="fullDate"
    class="relative inline-block shrink-0 whitespace-nowrap tabular-nums">
    <span aria-hidden="true" class="invisible">59mins ago</span>
    <span class="absolute inset-0 truncate">{{ relative }}</span>
  </time>
</template>
