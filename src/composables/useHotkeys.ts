import { onMounted, onUnmounted } from "vue";

import {
  getHotkeyMatch,
  type HotkeyHandlers,
  type HotkeyMatch,
} from "@/constants/hotkeys";
import { blocksHotkeys } from "@/utils/keyboard";

export function useHotkeys(handlers: HotkeyHandlers): void {
  function handleKeydown(event: KeyboardEvent): void {
    if (blocksHotkeys(event.target)) return;

    const hotkey = getHotkeyMatch(event);
    if (!hotkey || !runHandler(hotkey, handlers)) return;

    event.preventDefault();
  }

  onMounted(() => window.addEventListener("keydown", handleKeydown));
  onUnmounted(() => window.removeEventListener("keydown", handleKeydown));
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
    case "focusSearch": {
      const handler = handlers.focusSearch;
      return handler ? handler() !== false : false;
    }
    case "moveActiveTab": {
      const handler = handlers.moveActiveTab;
      return handler ? handler(hotkey.direction) !== false : false;
    }
    case "moveActiveItem": {
      const handler = handlers.moveActiveItem;
      return handler ? handler(hotkey.direction) !== false : false;
    }
    case "copyActiveItem": {
      const handler = handlers.copyActiveItem;
      return handler ? handler() !== false : false;
    }
    case "deleteSelectedItem": {
      const handler = handlers.deleteSelectedItem;
      return handler ? handler() !== false : false;
    }
    case "pinSelectedItem": {
      const handler = handlers.pinSelectedItem;
      return handler ? handler() !== false : false;
    }
  }
}
