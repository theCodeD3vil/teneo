export function isEditableKeyboardTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

// Text fields swallow hotkeys unless they opt in with data-hotkeys (the search field)
export function blocksHotkeys(target: EventTarget | null): boolean {
  return (
    isEditableKeyboardTarget(target) &&
    !(target as HTMLElement).hasAttribute("data-hotkeys")
  );
}

export function hasTypedText(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement) &&
    target.value !== ""
  );
}
