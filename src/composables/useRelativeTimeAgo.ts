import { formatTimeAgo, useNow } from "@vueuse/core";
import { computed } from "vue";

const currentTime = useNow();

/** A shared clock keeps every relative timestamp current without one timer per card. */
export function useRelativeTimeAgo(timestamp: number) {
  return computed(() =>
    formatTimeAgo(new Date(timestamp), undefined, currentTime.value),
  );
}
