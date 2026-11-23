import { ref, type WatchSource, watch } from "vue";

/** Only show a spinner once the wait has become noticeable. Controls still
 * use the original busy state so short actions can't be run twice. */
export function useDelayedBusy(busy: WatchSource<boolean>, delay = 1_000) {
  const show = ref(false);
  watch(
    busy,
    (pending, _previous, onCleanup) => {
      show.value = false;
      if (!pending) return;
      const timer = setTimeout(() => (show.value = true), delay);
      onCleanup(() => clearTimeout(timer));
    },
    { immediate: true },
  );
  return show;
}
