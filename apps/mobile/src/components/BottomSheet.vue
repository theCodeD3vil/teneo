<script setup lang="ts">
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@teneo/ui/components/sheet";
import { computed, ref, watch } from "vue";

import { useBackToClose } from "../composables/useNavigation";
import { trackSheetDepth } from "../composables/useSheetDepth";

/** A sheet that slides up from the bottom, as on iOS: the page steps back
 *  behind it, and a drag down, a tap outside or the back gesture closes it. */
const props = defineProps<{
  title: string;
  description?: string;
}>();

const isOpen = defineModel<boolean>("open", { required: true });
useBackToClose(isOpen);
const { setDrag } = trackSheetDepth(isOpen);

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
    <SheetContent
      side="bottom"
      :show-close-button="false"
      class="pb-safe max-h-[90dvh] gap-0 rounded-t-2xl border-none"
      :class="!isDragging && 'transition-transform duration-200'"
      :style="sheetStyle"
      @open-auto-focus.prevent>
      <div
        class="shrink-0 touch-none pt-2"
        @pointerdown="startDrag"
        @pointermove="drag"
        @pointerup="endDrag"
        @pointercancel="endDrag">
        <div class="bg-foreground/20 mx-auto h-1.5 w-10 rounded-full" />
        <SheetHeader class="items-center px-6 pt-3 pb-2 text-center">
          <SheetTitle class="text-lg font-medium text-balance">
            {{ props.title }}
          </SheetTitle>
          <SheetDescription
            :class="
              props.description ? 'text-foreground/60 text-balance' : 'sr-only'
            ">
            {{ props.description ?? props.title }}
          </SheetDescription>
        </SheetHeader>
      </div>
      <div class="min-h-0 overflow-y-auto overscroll-contain px-4 pt-2 pb-4">
        <slot />
      </div>
    </SheetContent>
  </Sheet>
</template>
