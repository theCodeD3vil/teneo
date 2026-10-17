const quickCopyItemNumbers = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

export type QuickCopyItemNumber = (typeof quickCopyItemNumbers)[number];

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
} as const;

export type HotkeyName = keyof typeof hotkeyDefinitions;

export type HotkeyMatch =
  | { name: "previewSelectedItem" }
  | { name: "copyItemByNumber"; itemNumber: QuickCopyItemNumber }
  | { name: "pasteSelectedItem" }
  | { name: "focusSearch" };

export type HotkeyPreviewKey =
  | { type: "modifier"; value: "command" | "option" | "control" | "shift" }
  | { type: "key"; value: string };

export type HotkeyProgress = {
  keys: HotkeyPreviewKey[];
  state: "partial" | "complete";
};

export type HotkeyHandlers = {
  previewSelectedItem?: () => boolean | void;
  copyItemByNumber?: (itemNumber: QuickCopyItemNumber) => boolean | void;
  pasteSelectedItem?: () => boolean | void;
  focusSearch?: () => boolean | void;
};

export function getHotkeyMatch(event: KeyboardEvent): HotkeyMatch | null {
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;

  if (hasNoModifiers(event) && event.code === "Space") {
    return { name: "previewSelectedItem" };
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
  if (hotkey) return progressFromHotkey(hotkey);

  if (event.key === "Meta" && hasOnlyCommandModifier(event)) {
    return {
      keys: [{ type: "modifier", value: "command" }],
      state: "partial",
    };
  }

  return null;
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

function progressFromHotkey(hotkey: HotkeyMatch): HotkeyProgress {
  switch (hotkey.name) {
    case "previewSelectedItem":
      return { keys: [{ type: "key", value: "Space" }], state: "complete" };
    case "copyItemByNumber":
      return {
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: String(hotkey.itemNumber) },
        ],
        state: "complete",
      };
    case "pasteSelectedItem":
      return {
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: "V" },
        ],
        state: "complete",
      };
    case "focusSearch":
      return {
        keys: [
          { type: "modifier", value: "command" },
          { type: "key", value: "/" },
        ],
        state: "complete",
      };
  }
}
