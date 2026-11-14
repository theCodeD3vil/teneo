<script setup lang="ts">
import { computed, ref } from "vue";
import CheckIcon from "~icons/tabler/check";
import SelectorIcon from "~icons/tabler/selector";

import BottomSheet from "./BottomSheet.vue";
import SheetGroup from "./SheetGroup.vue";

export interface SelectSheetOption {
  value: string;
  label: string;
}

const props = defineProps<{
  options: SelectSheetOption[];
  title: string;
  description?: string;
}>();

const value = defineModel<string>({ required: true });

const isOpen = ref(false);

const selectedLabel = computed(
  () => props.options.find((option) => option.value === value.value)?.label,
);

function select(option: SelectSheetOption): void {
  value.value = option.value;
  isOpen.value = false;
}
</script>

<template>
  <button
    type="button"
    class="border-input dark:bg-input/30 active:bg-foreground/5 flex h-9 items-center gap-x-1.5 rounded-md border pr-2 pl-3 text-sm whitespace-nowrap shadow-xs transition-colors"
    @click="isOpen = true">
    {{ selectedLabel }}
    <SelectorIcon class="text-muted-foreground size-4" aria-hidden="true" />
  </button>
  <BottomSheet
    v-model:open="isOpen"
    :title="props.title"
    :description="props.description">
    <SheetGroup role="listbox" :aria-label="props.title">
      <button
        v-for="option in props.options"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === value"
        class="active:bg-foreground/5 flex h-12 items-center justify-between px-4 text-left text-sm transition-colors"
        :class="option.value === value && 'text-primary'"
        @click="select(option)">
        {{ option.label }}
        <CheckIcon v-if="option.value === value" class="size-5" />
      </button>
    </SheetGroup>
  </BottomSheet>
</template>
