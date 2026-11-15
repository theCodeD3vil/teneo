import { shortTimeAgo } from "@teneo/shared/time/ago";
import { useIntervalFn, useNow } from "@vueuse/core";
import { computed } from "vue";

/** One clock for every relative timestamp and the list's day headers. A
 *  timestamp under a minute old counts seconds, so it ticks every second, not
 *  every frame. */
export const currentTime = useNow({
  scheduler: (update) => useIntervalFn(update, 1000),
});

/** A shared clock keeps every relative timestamp current without one timer per
 *  card. Short: "30s ago", "3mins ago", "4h ago", "3d ago". */
export function useRelativeTimeAgo(timestamp: number) {
  return computed(() => shortTimeAgo(timestamp, currentTime.value.getTime()));
}
