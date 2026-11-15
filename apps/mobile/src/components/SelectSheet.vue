<script setup lang="ts">
import { computed, ref } from "vue";
import CheckIcon from "~icons/tabler/check";
import SelectorIcon from "~icons/tabler/chevron-down";

import BottomSheet from "./BottomSheet.vue";

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
    class="bg-well active:bg-muted flex h-[2.75rem] items-center gap-x-1.5 rounded-full pr-3 pl-[1.125rem] text-[0.9375rem] font-semibold whitespace-nowrap transition-colors"
    @click="isOpen = true">
    {{ selectedLabel }}
    <SelectorIcon class="size-[1.125rem]" aria-hidden="true" />
  </button>
  <BottomSheet
    v-model:open="isOpen"
    :title="props.title"
    :description="props.description">
    <div role="listbox" :aria-label="props.title" class="grid gap-2">
      <button
        v-for="option in props.options"
        :key="option.value"
        type="button"
        role="option"
        :aria-selected="option.value === value"
        class="flex h-[3.5rem] items-center justify-between rounded-full pr-2 pl-[1.375rem] text-left text-sm transition-colors"
        :class="
          option.value === value
            ? 'bg-cta text-cta-foreground font-semibold'
            : 'bg-card active:bg-muted font-medium'
        "
        @click="select(option)">
        {{ option.label }}
        <span
          v-if="option.value === value"
          class="bg-primary text-primary-foreground grid size-[2.5rem] place-items-center rounded-full">
          <CheckIcon class="size-[1.25rem]" />
        </span>
      </button>
    </div>
  </BottomSheet>
</template>
