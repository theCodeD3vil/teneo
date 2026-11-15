<script setup lang="ts">
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
    <div class="grid gap-3 pt-2">
      <button
        type="button"
        class="sheet-button bg-destructive text-background"
        @click="confirm">
        {{ props.confirmLabel }}
      </button>
      <button
        type="button"
        class="sheet-button border-input bg-card border"
        @click="isOpen = false">
        Cancel
      </button>
    </div>
  </BottomSheet>
</template>
