<script setup lang="ts">
import BackIcon from "~icons/tabler/chevron-left";

import { useNavigation } from "../../composables/useNavigation";

defineProps<{
  backLabel: string;
}>();

const { goBack } = useNavigation();
</script>

<template>
  <header class="mb-6 flex shrink-0 flex-col gap-6">
    <button
      type="button"
      class="round-button"
      :aria-label="backLabel"
      @click="goBack">
      <BackIcon />
    </button>
    <div class="flex items-center gap-3 px-2">
      <slot />
    </div>
  </header>
</template>
