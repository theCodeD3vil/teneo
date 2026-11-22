<script setup lang="ts">
import { possibleCredentialLabel } from "@teneo/shared/types/clipboard";
import { computed, useId } from "vue";

const props = defineProps<{
  labels: readonly string[];
  showMaskCredit?: boolean;
  maskTooltip?: string;
}>();
const gradient = `secret-sparkle-${useId()}`;
const hasAiMask = computed(() => props.labels.includes(possibleCredentialLabel));
const labels = computed(() =>
  props.labels.filter((label) => label !== possibleCredentialLabel).join(", "),
);
</script>

<template>
  <span class="inline-flex min-w-0 items-center gap-1">
    <svg
      v-if="hasAiMask"
      :aria-hidden="showMaskCredit ? true : undefined"
      :aria-label="showMaskCredit ? undefined : (maskTooltip ?? possibleCredentialLabel)"
      role="img"
      class="size-4 shrink-0"
      viewBox="0 0 24 24">
      <title>{{ maskTooltip ?? possibleCredentialLabel }}</title>
      <defs>
        <linearGradient
          :id="gradient"
          gradientUnits="userSpaceOnUse"
          x1="4"
          y1="2"
          x2="18"
          y2="22">
          <stop offset="0%" stop-color="#ffcf65" />
          <stop offset="48%" stop-color="#f79b65" />
          <stop offset="100%" stop-color="#db5845" />
        </linearGradient>
      </defs>
      <path
        :fill="`url(#${gradient})`"
        d="M10 3a.8.8 0 0 1 .74.5l1.68 4.3a4 4 0 0 0 2.28 2.28L19 11.76a.8.8 0 0 1 0 1.48l-4.3 1.68a4 4 0 0 0-2.28 2.28l-1.68 4.3a.8.8 0 0 1-1.48 0l-1.68-4.3a4 4 0 0 0-2.28-2.28L1 13.24a.8.8 0 0 1 0-1.48l4.3-1.68A4 4 0 0 0 7.58 7.8l1.68-4.3A.8.8 0 0 1 10 3Zm9-2a.5.5 0 0 1 .47.32l.78 2.04a1.7 1.7 0 0 0 .99.99l2.04.78a.5.5 0 0 1 0 .94l-2.04.78a1.7 1.7 0 0 0-.99.99l-.78 2.04a.5.5 0 0 1-.94 0l-.78-2.04a1.7 1.7 0 0 0-.99-.99l-2.04-.78a.5.5 0 0 1 0-.94l2.04-.78a1.7 1.7 0 0 0 .99-.99l.78-2.04A.5.5 0 0 1 19 1Z" />
    </svg>
    <span v-if="hasAiMask && showMaskCredit" class="shrink-0 whitespace-nowrap">
      Masked by AI
    </span>
    <span v-if="labels" class="min-w-0 truncate">{{ labels }}</span>
  </span>
</template>
