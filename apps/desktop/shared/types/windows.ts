// Pushed to the main window to open the panel under the menu bar icon
export const showPanelEvent = "show-panel";

// Pushed to the update window while the update downloads
export const updateProgressEvent = "update-progress";

export interface UpdateProgress {
  received: number;
  /** null while the server hasn't said how big the download is */
  total: number | null;
}
