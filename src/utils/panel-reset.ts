export const resetPanelEvent = "teneo:reset-panel";

// Tells TabManager to go back to the All tab. Sent as the panel hides, so the
// render happens while it's hidden, and again before it shows in case it was
// hidden some other way.
export function resetPanel(): void {
  window.dispatchEvent(new Event(resetPanelEvent));
}

/** Hide the panel, e.g. once an opened file or link takes the user elsewhere. */
export async function hidePanel(): Promise<void> {
  await tiny.api.call("hidePanel");
  resetPanel();
}
