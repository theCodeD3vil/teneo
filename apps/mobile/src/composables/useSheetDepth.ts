import { computed, onScopeDispose, ref, watch, type Ref } from "vue";

const openSheets = ref(0);
// how far the open sheet has been dragged toward closed: 0 open, 1 closed
const dragProgress = ref(0);
const isDragging = ref(false);

/** How far the page has stepped back behind an open sheet: 0 not at all,
 *  1 fully. */
export function useSheetDepth() {
  const depth = computed(() =>
    openSheets.value > 0 ? 1 - dragProgress.value : 0,
  );
  return { depth, isDragging: computed(() => isDragging.value) };
}

/** The page steps back while `open` is true, and follows the sheet's drag. */
export function trackSheetDepth(open: Ref<boolean>) {
  let isCounted = false;

  function count(shouldCount: boolean): void {
    if (shouldCount === isCounted) return;
    isCounted = shouldCount;
    openSheets.value += shouldCount ? 1 : -1;
    dragProgress.value = 0;
    isDragging.value = false;
  }

  watch(open, count, { immediate: true });
  onScopeDispose(() => count(false));

  return {
    /** `progress` 0..1 while the finger is down; null once it lifts */
    setDrag(progress: number | null): void {
      isDragging.value = progress !== null;
      dragProgress.value = Math.min(Math.max(progress ?? 0, 0), 1);
    },
  };
}
