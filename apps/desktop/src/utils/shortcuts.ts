// Global shortcuts are stored as tinyjs combos ("ctrl+opt+v"). Keys are read
// from KeyboardEvent.code, the physical key, which is also what macOS matches
// global shortcuts against, so any keyboard layout records correctly.

const modifierOrder = ["ctrl", "opt", "shift", "cmd"] as const;
type Modifier = (typeof modifierOrder)[number];

const modifierLabels: Record<Modifier, string> = {
  ctrl: "⌃",
  opt: "⌥",
  shift: "⇧",
  cmd: "⌘",
};

// Keys tinyjs can register as a global shortcut (arrows and F-keys can't be)
const keyNamesByCode: Record<string, string> = {
  Space: "space",
  Enter: "return",
  Tab: "tab",
  Backspace: "delete",
  Comma: "comma",
  Period: "period",
  Slash: "slash",
  Semicolon: "semicolon",
  Quote: "quote",
  Minus: "minus",
  Equal: "equal",
  BracketLeft: "bracketleft",
  BracketRight: "bracketright",
  Backslash: "backslash",
  Backquote: "grave",
};

const keyLabels: Record<string, string> = {
  space: "Space",
  return: "↩",
  tab: "⇥",
  delete: "⌫",
  comma: ",",
  period: ".",
  slash: "/",
  semicolon: ";",
  quote: "'",
  minus: "-",
  equal: "=",
  bracketleft: "[",
  bracketright: "]",
  backslash: "\\",
  grave: "`",
};

export type ShortcutRecording =
  | { status: "incomplete" }
  | { status: "invalid"; reason: string }
  | { status: "complete"; shortcut: string };

/** Turn a keydown into a shortcut, or say why it can't be one. */
export function readShortcut(event: KeyboardEvent): ShortcutRecording {
  const key = getKeyName(event.code);
  const isModifierKey = /^(Meta|Control|Alt|Shift)/.test(event.code);
  if (isModifierKey) return { status: "incomplete" };
  if (!key) {
    return { status: "invalid", reason: "Use a letter, number or symbol key" };
  }

  const modifiers = modifierOrder.filter(
    (modifier) =>
      ({
        ctrl: event.ctrlKey,
        opt: event.altKey,
        shift: event.shiftKey,
        cmd: event.metaKey,
      })[modifier],
  );
  // ⌘ or ⇧ alone would take over shortcuts apps rely on, like ⌘C
  const hasEnoughModifiers =
    modifiers.includes("ctrl") ||
    modifiers.includes("opt") ||
    (modifiers.includes("cmd") && modifiers.includes("shift"));
  if (!hasEnoughModifiers) {
    return { status: "invalid", reason: "Add ⌃ or ⌥, or use ⇧ with ⌘" };
  }
  return { status: "complete", shortcut: [...modifiers, key].join("+") };
}

/** "ctrl+opt+v" → ["⌃", "⌥", "V"] */
export function getShortcutLabels(shortcut: string): string[] {
  return shortcut
    .split("+")
    .map(
      (part) =>
        modifierLabels[part as Modifier] ??
        keyLabels[part] ??
        part.toUpperCase(),
    );
}

function getKeyName(code: string): string | undefined {
  const letterOrDigit = /^(?:Key([A-Z])|Digit(\d))$/.exec(code);
  if (letterOrDigit) {
    return (letterOrDigit[1] ?? letterOrDigit[2]).toLowerCase();
  }
  return keyNamesByCode[code];
}
