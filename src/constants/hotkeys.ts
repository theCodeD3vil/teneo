import { hasTypedText, isEditableKeyboardTarget } from "@/utils/keyboard";

const quickCopyItemNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type QuickCopyItemNumber = (typeof quickCopyItemNumbers)[number];
export type NavigationDirection = -1 | 1;

export const hotkeyDefinitions = {
  previewSelectedItem: {
    id: "preview-selected-item",
    shortcut: "Space",
    description: "Preview the selected item",
  },
  copyItemByNumber: {
    id: "copy-item-by-number",
    shortcut: "⌘ 1–9",
    description: "Copy one of the first nine items",
  },
  pasteSelectedItem: {
    id: "paste-selected-item",
    shortcut: "⌘ V",
    description: "Paste the selected item",
  },
  focusSearch: {
    id: "focus-search",
    shortcut: "⌘ /",
    description: "Focus the search field",
  },
  moveActiveTab: {
    id: "move-active-tab",
    shortcut: "← / →",
    description: "Move between tabs",
  },
  moveActiveItem: {
    id: "move-active-item",
    shortcut: "↑ / ↓",
    description: "Move between items",
  },
  copyActiveItem: {
    id: "copy-active-item",
    shortcut: "Enter",
    description: "Copy the active item",
  },
} as const;

// D and P are left out of hotkeyDefinitions so Settings doesn't list them; the README does
export type HotkeyMatch =
  | { name: "previewSelectedItem" }
  | { name: "copyItemByNumber"; itemNumber: QuickCopyItemNumber }
  | { name: "pasteSelectedItem" }
  | { name: "focusSearch" }
  | { name: "moveActiveTab"; direction: NavigationDirection }
  | { name: "moveActiveItem"; direction: NavigationDirection }
  | { name: "copyActiveItem" }
  | { name: "deleteSelectedItem" }
  | { name: "pinSelectedItem" };

export type HotkeyPreviewKey =
  | { type: "modifier"; value: "command" | "option" | "control" | "shift" }
  | { type: "key"; value: string };

export type HotkeyProgress = {
  hotkeyName: HotkeyMatch["name"] | null;
  keys: HotkeyPreviewKey[];
  state: "partial" | "complete";
};

export type HotkeyHandlers = {
  previewSelectedItem?: () => boolean | void;
  copyItemByNumber?: (itemNumber: QuickCopyItemNumber) => boolean | void;
  pasteSelectedItem?: () => boolean | void;
  focusSearch?: () => boolean | void;
  moveActiveTab?: (direction: NavigationDirection) => boolean | void;
  moveActiveItem?: (direction: NavigationDirection) => boolean | void;
  copyActiveItem?: () => boolean | void;
  deleteSelectedItem?: () => boolean | void;
  pinSelectedItem?: () => boolean | void;
};

export function getHotkeyMatch(event: KeyboardEvent): HotkeyMatch | null {
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.repeat && event.key !== "ArrowUp" && event.key !== "ArrowDown") {
    return null;
  }

  if (hasNoModifiers(event)) {
    if (isTextEditingKey(event)) return null;
    if (event.code === "Space") return { name: "previewSelectedItem" };
    if (event.key === "ArrowLeft") {
      return { name: "moveActiveTab", direction: -1 };
    }
    if (event.key === "ArrowRight") {
      return { name: "moveActiveTab", direction: 1 };
    }
    if (event.key === "ArrowUp") {
      return { name: "moveActiveItem", direction: -1 };
    }
    if (event.key === "ArrowDown") {
      return { name: "moveActiveItem", direction: 1 };
    }
    if (event.key === "Enter") return { name: "copyActiveItem" };

    // Letters type into the focused search field instead
    if (!isEditableKeyboardTarget(event.target)) {
      const key = event.key.toLowerCase();
      if (key === "d") return { name: "deleteSelectedItem" };
      if (key === "p") return { name: "pinSelectedItem" };
    }
  }

  if (!hasOnlyCommandModifier(event)) return null;

  if (event.key === "v") return { name: "pasteSelectedItem" };
  if (event.key === "/") return { name: "focusSearch" };

  const itemNumber = Number(event.key);
  if (isQuickCopyItemNumber(itemNumber)) {
    return { name: "copyItemByNumber", itemNumber };
  }

  return null;
}

export function getHotkeyProgress(event: KeyboardEvent): HotkeyProgress | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;

  const hotkey = getHotkeyMatch(event);
  if (hotkey?.name === "moveActiveItem" || hotkey?.name === "moveActiveTab") {
    return null;
  }
  if (hotkey) return progressFromHotkey(hotkey);

  if (event.key === "Meta" && hasOnlyCommandModifier(event)) {
    return {
      hotkeyName: null,
      keys: [{ type: "modifier", value: "command" }],
      state: "partial",
    };
  }

  return null;
}

// Once the search field has text, Space and ←/→ type and move the cursor instead
function isTextEditingKey(event: KeyboardEvent): boolean {
  const editsText =
    event.code === "Space" ||
    event.key === "ArrowLeft" ||
    event.key === "ArrowRight";
  return editsText && hasTypedText(event.target);
}

function hasNoModifiers(event: KeyboardEvent): boolean {
  return !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function hasOnlyCommandModifier(event: KeyboardEvent): boolean {
  return event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey;
}

function isQuickCopyItemNumber(
  itemNumber: number,
): itemNumber is QuickCopyItemNumber {
  return quickCopyItemNumbers.includes(itemNumber as QuickCopyItemNumber);
}

function progressFromHotkey(
  hotkey: Exclude<HotkeyMatch, { name: "moveActiveTab" | "moveActiveItem" }>,
): HotkeyProgress {
  switch (hotkey.name) {
    case "previewSelectedItem":
      return {
        hotkeyName: hotkey.name,
        keys: [{ type: "key", value: "Space" }],
        state: "complete",
      };
    case "copyItemByNumber":
      return {
        hotkeyName: hotkey.name,
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: String(hotkey.itemNumber) },
        ],
        state: "complete",
      };
    case "pasteSelectedItem":
      return {
        hotkeyName: hotkey.name,
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: "V" },
        ],
        state: "complete",
      };
    case "focusSearch":
      return {
        hotkeyName: hotkey.name,
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: "/" },
        ],
        state: "complete",
      };
    case "copyActiveItem":
      return {
        hotkeyName: hotkey.name,
        keys: [{ type: "key", value: "Enter" }],
        state: "complete",
      };
    case "deleteSelectedItem":
      return {
        hotkeyName: hotkey.name,
        keys: [{ type: "key", value: "D" }],
        state: "complete",
      };
    case "pinSelectedItem":
      return {
        hotkeyName: hotkey.name,
        keys: [{ type: "key", value: "P" }],
        state: "complete",
      };
  }
}
