export const resetPanelEvent = "teneo:reset-panel";
export const panelVisibilityEvent = "teneo:panel-visibility";

// Tells TabManager to go back to the All tab. Sent as the panel hides, so the
// render happens while it's hidden, and again before it shows in case it was
// hidden some other way.
export function resetPanel(): void {
  window.dispatchEvent(new Event(resetPanelEvent));
}

/** Tells the page the panel was just hidden or shown: while it's hidden, what
 *  it cached for the list is let go of (see usePanelIdleCleanup). */
export function notifyPanelVisibility(visible: boolean): void {
  window.dispatchEvent(
    new CustomEvent(panelVisibilityEvent, { detail: { visible } }),
  );
}

export function isPanelVisibilityEvent(
  event: Event,
): event is CustomEvent<{ visible: boolean }> {
  return event.type === panelVisibilityEvent;
}

/** Hide the panel, e.g. once an opened file or link takes the user elsewhere. */
export async function hidePanel(): Promise<void> {
  await tiny.api.call("hidePanel");
  notifyPanelVisibility(false);
  resetPanel();
}
