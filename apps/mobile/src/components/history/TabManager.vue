<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@teneo/ui/components/tabs";
import {
  type ComponentPublicInstance,
  computed,
  nextTick,
  onUnmounted,
  ref,
  watch,
} from "vue";

import { useClipboardList } from "../../composables/useClipboard";
import { emptyMessages, tabValues, type TabVariant } from "../../types/tabs";
import AllTabContent from "./AllTabContent.vue";

const props = defineProps<{
  searchQuery: string;
}>();

const emit = defineEmits<{
  (e: "tab-change", count: number): void;
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const selectedTab = ref<TabVariant>("all");
const debouncedSearchQuery = ref(normalizeSearchQuery(props.searchQuery));
const { items, total, error, loading, hasMore, loadingMore, loadMore } =
  useClipboardList(() => ({
    kind: selectedTab.value,
    search: debouncedSearchQuery.value,
  }));
let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

function normalizeSearchQuery(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

watch(
  () => props.searchQuery,
  (searchQuery) => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      debouncedSearchQuery.value = normalizeSearchQuery(searchQuery);
    }, 200);
  },
);

// how many the tab holds in all, not only the pages loaded so far
watch(total, (count) => emit("tab-change", count), { immediate: true });

onUnmounted(() => clearTimeout(searchDebounceTimeout));

// --- swiping the list sideways moves to the next or previous tab, and the
// list slides with the finger. A tap on a tab slides the same way.

const swipeArea = ref<HTMLElement | null>(null);
const tabBar = ref<ComponentPublicInstance | null>(null);

const axisLockDistance = 10; // px before a drag counts as sideways or a scroll
const commitFraction = 0.25; // of the width, dragged past this switches tabs
const commitSpeed = 0.4; // px per ms, a flick faster than this switches too
const enterFraction = 0.3; // of the width, where the next list slides in from
const easeOut = "cubic-bezier(0.32, 0.72, 0, 1)";
const easeIn = "cubic-bezier(0.4, 0, 1, 1)";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const swipeOffset = ref(0);
const swipeWidth = ref(1);
const swipeTransition = ref("none");
const swipeStyle = computed(() => ({
  transform: swipeOffset.value
    ? `translateX(${swipeOffset.value}px)`
    : undefined,
  opacity:
    1 - Math.min(Math.abs(swipeOffset.value) / swipeWidth.value, 1) * 0.7,
  transition: swipeTransition.value,
}));

let swipe: {
  x: number;
  y: number;
  time: number;
  axis: "x" | "y" | null;
} | null = null;
// the finger lifting after a swipe isn't a tap: it mustn't copy a card
let didSwipe = false;
let isSwitching = false;

function slideTo(offset: number, duration: number, easing: string) {
  const time = reducedMotion.matches ? 0 : duration;
  swipeTransition.value = time
    ? `transform ${time}ms ${easing}, opacity ${time}ms ${easing}`
    : "none";
  swipeOffset.value = offset;
  return new Promise((resolve) => setTimeout(resolve, time));
}

function measureSwipeWidth(): number {
  swipeWidth.value = swipeArea.value?.clientWidth || window.innerWidth;
  return swipeWidth.value;
}

function startSwipe(event: PointerEvent): void {
  didSwipe = false;
  if (event.pointerType === "mouse" || isSwitching) return;
  swipe = {
    x: event.clientX,
    y: event.clientY,
    time: event.timeStamp,
    axis: null,
  };
  measureSwipeWidth();
}

function moveSwipe(event: PointerEvent): void {
  if (!swipe) return;
  const dx = event.clientX - swipe.x;
  const dy = event.clientY - swipe.y;
  if (!swipe.axis) {
    if (Math.hypot(dx, dy) < axisLockDistance) return;
    swipe.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    if (swipe.axis === "x") swipeArea.value?.setPointerCapture(event.pointerId);
  }
  if (swipe.axis !== "x") return;
  didSwipe = true;
  const index = tabValues.indexOf(selectedTab.value);
  const hasNextTab = dx < 0 ? index < tabValues.length - 1 : index > 0;
  // past the first or last tab it only stretches a little
  swipeTransition.value = "none";
  swipeOffset.value = hasNextTab ? dx : dx / 4;
}

function endSwipe(event: PointerEvent): void {
  const ended = swipe;
  swipe = null;
  if (ended?.axis !== "x") return;
  const offset = swipeOffset.value;
  const speed = Math.abs(offset) / Math.max(event.timeStamp - ended.time, 1);
  const step = offset < 0 ? 1 : -1;
  const target = tabValues[tabValues.indexOf(selectedTab.value) + step];
  const isFarEnough =
    Math.abs(offset) > swipeWidth.value * commitFraction || speed > commitSpeed;
  if (target && isFarEnough) void leaveTo(target, step);
  else void slideTo(0, 250, easeOut);
}

function cancelSwipe(): void {
  const ended = swipe;
  swipe = null;
  if (ended?.axis === "x") void slideTo(0, 250, easeOut);
}

function swallowSwipeClick(event: MouseEvent): void {
  if (!didSwipe) return;
  didSwipe = false;
  event.stopPropagation();
  event.preventDefault();
}

// the current list leaves the way the finger went; the tab watcher below
// brings the next one in
async function leaveTo(target: TabVariant, step: number): Promise<void> {
  isSwitching = true;
  await slideTo(-step * swipeWidth.value, 160, easeIn);
  selectedTab.value = target;
}

function waitForList(): Promise<void> {
  if (!loading.value) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, 300);
    const stop = watch(loading, (isLoading) => isLoading || done());
    function done(): void {
      clearTimeout(timeout);
      stop();
      resolve();
    }
  });
}

// scrollIntoView would nudge the page vertically too; only the bar moves
function centerActiveTab(): void {
  const bar = tabBar.value?.$el as HTMLElement | undefined;
  const tab = bar?.querySelector?.("[data-state=active]");
  if (!bar || !tab) return;
  const barBox = bar.getBoundingClientRect();
  const tabBox = tab.getBoundingClientRect();
  bar.scrollTo({
    left:
      bar.scrollLeft +
      tabBox.left -
      barBox.left -
      (barBox.width - tabBox.width) / 2,
    behavior: reducedMotion.matches ? "auto" : "smooth",
  });
}

const nextFrame = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

watch(selectedTab, async (tab, previous) => {
  void nextTick(centerActiveTab);
  isSwitching = true;
  const step = Math.sign(tabValues.indexOf(tab) - tabValues.indexOf(previous));
  swipeTransition.value = "none";
  swipeOffset.value = step * measureSwipeWidth() * enterFraction;
  await waitForList();
  await nextFrame();
  await slideTo(0, 300, easeOut);
  isSwitching = false;
});
</script>

<template>
  <Tabs
    v-model="selectedTab"
    class="flex min-h-0 w-full flex-1 flex-col bg-transparent!">
    <!-- scrolls sideways if a narrow phone can't fit every tab -->
    <TabsList
      ref="tabBar"
      class="h-auto! w-full shrink-0 touch-pan-x [scrollbar-width:none] justify-start gap-x-2 overflow-x-auto overflow-y-hidden bg-transparent! p-0!">
      <div v-for="tabItem in tabValues" :key="tabItem" class="shrink-0">
        <TabsTrigger
          class="data-active:bg-primary/10! dark:data-active:bg-primary/20! bg-foreground/5 dark:bg-foreground/10 data-active:text-primary! data-active:border-primary/80! h-9 min-w-14 rounded-full px-3.5 text-sm font-normal capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
    </TabsList>
    <TabsContent
      :value="selectedTab"
      force-mount
      class="mt-3 min-h-0 flex-1 overflow-hidden bg-transparent!">
      <div
        ref="swipeArea"
        class="size-full"
        :style="swipeStyle"
        @pointerdown="startSwipe"
        @pointermove="moveSwipe"
        @pointerup="endSwipe"
        @pointercancel="cancelSwipe"
        @click.capture="swallowSwipeClick">
        <AllTabContent
          :items="items"
          :tab="selectedTab"
          :loading="loading"
          :error="error"
          :has-more="hasMore"
          :loading-more="loadingMore"
          :empty-message="emptyMessages[selectedTab]"
          :search-query="debouncedSearchQuery"
          @preview="emit('preview', $event)"
          @load-more="loadMore" />
      </div>
    </TabsContent>
  </Tabs>
</template>
