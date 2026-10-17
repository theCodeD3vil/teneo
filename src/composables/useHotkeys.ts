import { onMounted, onUnmounted } from "vue";

import {
  getHotkeyMatch,
  type HotkeyHandlers,
  type HotkeyMatch,
} from "@/constants/hotkeys";

export function useHotkeys(handlers: HotkeyHandlers): void {
  function handleKeydown(event: KeyboardEvent): void {
    if (isEditableTarget(event.target)) return;

    const hotkey = getHotkeyMatch(event);
    if (!hotkey || !runHandler(hotkey, handlers)) return;

    event.preventDefault();
  }

  onMounted(() => window.addEventListener("keydown", handleKeydown));
  onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
}

function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function runHandler(hotkey: HotkeyMatch, handlers: HotkeyHandlers): boolean {
  switch (hotkey.name) {
    case "previewSelectedItem": {
      const handler = handlers.previewSelectedItem;
      return handler ? handler() !== false : false;
    }
    case "copyItemByNumber": {
      const handler = handlers.copyItemByNumber;
      return handler ? handler(hotkey.itemNumber) !== false : false;
    }
    case "pasteSelectedItem": {
      const handler = handlers.pasteSelectedItem;
      return handler ? handler() !== false : false;
    }
  }
}
