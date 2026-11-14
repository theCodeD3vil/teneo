import { useQueryClient } from "@tanstack/vue-query";
import { onMounted, onUnmounted } from "vue";

import {
  type ClipboardListData,
  clipboardItemsQueryKey,
} from "@/composables/useClipboard";
import {
  isPanelVisibilityEvent,
  panelVisibilityEvent,
} from "@/utils/panel-reset";

// How long the panel stays hidden before what it cached is let go of
const idleCleanupDelay = 2 * 60 * 1000;

/**
 * Keeps a hidden panel small. As it hides, the list goes back to its first
 * page (it's reset to the top anyway) and the lists of other tabs and
 * searches are dropped. Hidden for a while, every preview, icon and item
 * nothing on screen uses goes too; they reload when their card next shows.
 */
export function usePanelIdleCleanup(): void {
  const queryClient = useQueryClient();
  let cleanupTimeout: ReturnType<typeof setTimeout> | undefined;

  function handleVisibilityChange(event: Event): void {
    if (!isPanelVisibilityEvent(event)) return;
    clearTimeout(cleanupTimeout);
    if (event.detail.visible) return;

    queryClient.setQueriesData<ClipboardListData>(
      { queryKey: clipboardItemsQueryKey },
      (data) =>
        data && data.pages.length > 1
          ? {
              pages: data.pages.slice(0, 1),
              pageParams: data.pageParams.slice(0, 1),
            }
          : data,
    );
    queryClient.removeQueries({
      queryKey: clipboardItemsQueryKey,
      type: "inactive",
    });
    cleanupTimeout = setTimeout(() => {
      queryClient.removeQueries({ type: "inactive" });
    }, idleCleanupDelay);
  }

  onMounted(() =>
    window.addEventListener(panelVisibilityEvent, handleVisibilityChange),
  );
  onUnmounted(() => {
    window.removeEventListener(panelVisibilityEvent, handleVisibilityChange);
    clearTimeout(cleanupTimeout);
  });
}
