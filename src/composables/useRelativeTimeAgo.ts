import { formatTimeAgo, useIntervalFn, useNow } from "@vueuse/core";
import { computed } from "vue";

/** One clock for every relative timestamp and the list's day headers. Their text
 *  changes at most once a minute, so it ticks every 30 s, not every frame. */
export const currentTime = useNow({
  scheduler: (update) => useIntervalFn(update, 30_000),
});

/** A shared clock keeps every relative timestamp current without one timer per card. */
export function useRelativeTimeAgo(timestamp: number) {
  return computed(() =>
    formatTimeAgo(new Date(timestamp), undefined, currentTime.value),
  );
}
