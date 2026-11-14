<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";

import BottomSheet from "./BottomSheet.vue";

/** Asks before something that's hard to undo; the mobile take on the
 *  desktop's alert dialog. */
const props = defineProps<{
  title: string;
  description: string;
  confirmLabel: string;
}>();

const emit = defineEmits<{
  (e: "confirm"): void;
}>();

const isOpen = defineModel<boolean>("open", { required: true });

function confirm(): void {
  isOpen.value = false;
  emit("confirm");
}
</script>

<template>
  <BottomSheet
    v-model:open="isOpen"
    :title="props.title"
    :description="props.description">
    <div class="grid gap-2 pt-2">
      <Button variant="destructive" class="h-12 text-sm" @click="confirm">
        {{ props.confirmLabel }}
      </Button>
      <Button variant="secondary" class="h-12 text-sm" @click="isOpen = false">
        Cancel
      </Button>
    </div>
  </BottomSheet>
</template>
