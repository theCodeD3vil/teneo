<script setup lang="ts">
import Button from "@teneo/ui/components/button/Button.vue";
import BackIcon from "~icons/tabler/chevron-left";

import { useNavigation } from "../../composables/useNavigation";

defineProps<{
  backLabel: string;
}>();

const { goBack } = useNavigation();
</script>

<template>
  <header
    class="relative mb-6 flex h-9 shrink-0 items-center justify-center gap-x-2">
    <Button
      variant="ghost"
      size="icon"
      class="text-foreground/70 absolute left-0"
      :aria-label="backLabel"
      @click="goBack">
      <BackIcon />
    </Button>
    <slot />
  </header>
</template>
