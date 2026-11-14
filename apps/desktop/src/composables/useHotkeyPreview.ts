import { onMounted, onUnmounted, ref } from "vue";

import { getHotkeyProgress, type HotkeyProgress } from "@/constants/hotkeys";
import { blocksHotkeys } from "@/utils/keyboard";

const PARTIAL_HOTKEY_TIMEOUT = 5_000;
const COMPLETED_HOTKEY_TIMEOUT = 1500;

/** The keys just pressed, as `getProgress` reads them: the list's hotkeys by
 *  default, or another view's own, such as the item preview's. */
export function useHotkeyPreview(
  getProgress: (
    event: KeyboardEvent,
  ) => HotkeyProgress | null = getHotkeyProgress,
) {
  const hotkeyProgress = ref<HotkeyProgress | null>(null);
  let resetTimeout: ReturnType<typeof setTimeout> | undefined;

  function clearHotkeyPreview(): void {
    hotkeyProgress.value = null;
    resetTimeout = undefined;
  }

  function scheduleHotkeyPreviewReset(timeout: number): void {
    clearTimeout(resetTimeout);
    resetTimeout = setTimeout(clearHotkeyPreview, timeout);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (blocksHotkeys(event.target)) return;

    const progress = getProgress(event);
    if (!progress) return;

    hotkeyProgress.value = progress;
    scheduleHotkeyPreviewReset(
      progress.state === "complete"
        ? COMPLETED_HOTKEY_TIMEOUT
        : PARTIAL_HOTKEY_TIMEOUT,
    );
  }

  onMounted(() => window.addEventListener("keydown", handleKeydown, true));
  onUnmounted(() => {
    window.removeEventListener("keydown", handleKeydown, true);
    clearTimeout(resetTimeout);
  });

  return { hotkeyProgress };
}
