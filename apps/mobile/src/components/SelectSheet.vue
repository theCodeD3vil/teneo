<script setup lang="ts">
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@teneo/ui/components/sheet";
import { computed, ref, watch } from "vue";
import CheckIcon from "~icons/tabler/check";
import SelectorIcon from "~icons/tabler/selector";

import { useBackToClose } from "../composables/useNavigation";
import { trackSheetDepth } from "../composables/useSheetDepth";

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
useBackToClose(isOpen);
const { setDrag } = trackSheetDepth(isOpen);

const selectedLabel = computed(
  () => props.options.find((option) => option.value === value.value)?.label,
);

function select(option: SelectSheetOption): void {
  value.value = option.value;
  isOpen.value = false;
}

// --- dragging the sheet down past this far, or flicking it, closes it

const closeDistance = 80;
const closeSpeed = 0.5; // px per ms
const dragOffset = ref(0);
const isDragging = ref(false);
let dragStart: { y: number; time: number; sheetHeight: number } | null = null;

function startDrag(event: PointerEvent): void {
  const sheet = (event.currentTarget as HTMLElement).closest(
    "[data-slot=sheet-content]",
  );
  dragStart = {
    y: event.clientY,
    time: event.timeStamp,
    sheetHeight: sheet?.clientHeight || window.innerHeight,
  };
  isDragging.value = true;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function drag(event: PointerEvent): void {
  if (!dragStart) return;
  // pulling up stretches a little, as on iOS, instead of lifting the sheet
  const distance = event.clientY - dragStart.y;
  dragOffset.value = distance > 0 ? distance : distance / 6;
  setDrag(dragOffset.value / dragStart.sheetHeight);
}

function endDrag(event: PointerEvent): void {
  if (!dragStart) return;
  const elapsed = Math.max(event.timeStamp - dragStart.time, 1);
  const speed = dragOffset.value / elapsed;
  dragStart = null;
  isDragging.value = false;
  setDrag(null);
  if (dragOffset.value > closeDistance || speed > closeSpeed) {
    isOpen.value = false;
  } else {
    dragOffset.value = 0;
  }
}

// the closing slide starts from wherever the drag left the sheet
const sheetStyle = computed(() =>
  dragOffset.value ? { transform: `translateY(${dragOffset.value}px)` } : {},
);
watch(isOpen, (open) => {
  if (open) dragOffset.value = 0;
});
</script>

<template>
  <Sheet v-model:open="isOpen">
    <button
      type="button"
      class="border-input dark:bg-input/30 active:bg-foreground/5 flex h-9 items-center gap-x-1.5 rounded-md border pr-2 pl-3 text-sm whitespace-nowrap shadow-xs transition-colors"
      @click="isOpen = true">
      {{ selectedLabel }}
      <SelectorIcon class="text-muted-foreground size-4" aria-hidden="true" />
    </button>
    <SheetContent
      side="bottom"
      :show-close-button="false"
      class="pb-safe gap-0 rounded-t-2xl border-none"
      :class="!isDragging && 'transition-transform duration-200'"
      :style="sheetStyle"
      @open-auto-focus.prevent>
      <div
        class="touch-none pt-2"
        @pointerdown="startDrag"
        @pointermove="drag"
        @pointerup="endDrag"
        @pointercancel="endDrag">
        <div class="bg-foreground/20 mx-auto h-1.5 w-10 rounded-full" />
        <SheetHeader class="items-center px-4 pt-3 pb-2 text-center">
          <SheetTitle class="text-lg">{{ title }}</SheetTitle>
          <SheetDescription :class="description ? 'text-balance' : 'sr-only'">
            {{ description ?? `Choose ${title.toLowerCase()}` }}
          </SheetDescription>
        </SheetHeader>
      </div>
      <div
        class="bg-foreground/5 dark:bg-foreground/6 divide-foreground/10 mx-4 mt-2 mb-4 grid divide-y overflow-hidden rounded-lg"
        role="listbox"
        :aria-label="title">
        <button
          v-for="option in options"
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
      </div>
    </SheetContent>
  </Sheet>
</template>
