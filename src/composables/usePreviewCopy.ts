import { onKeyStroke } from "@vueuse/core";
import { computed, onUnmounted, ref } from "vue";

import { isInMenu } from "@/utils/keyboard";
import { hidePanel } from "@/utils/panel-reset";

const ITEM_KEY = "item";

/** The preview's copy: the button copies and shows a tick, Enter copies and
 *  hides the panel like it does on the list. A preview with several copy
 *  buttons passes each its own data and key, so only that one ticks. */
export function usePreviewCopy(getData: () => TinyClipboardWrite | null) {
  const copiedKey = ref<string | null>(null);
  const isCopied = computed(() => copiedKey.value === ITEM_KEY);
  let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

  async function copy(
    hideWindow: boolean,
    data = getData(),
    key = ITEM_KEY,
  ): Promise<void> {
    if (!data) return;

    await tiny.clipboard.write(data);
    if (hideWindow) return hidePanel();

    copiedKey.value = key;
    clearTimeout(copiedTimeout);
    copiedTimeout = setTimeout(() => (copiedKey.value = null), 1500);
  }

  onKeyStroke(
    "Enter",
    (event) => {
      if (isInMenu(event.target)) return;
      event.preventDefault();
      void copy(true).catch(() => undefined);
    },
    { dedupe: true },
  );
  onUnmounted(() => clearTimeout(copiedTimeout));

  return { isCopied, copiedKey, copy };
}
