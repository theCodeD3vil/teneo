// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
import { getAppIconUrl } from "./app-icons";
import { readClipboardItem } from "./clipboard-history";
import { getFilePreviewUrl } from "./file-previews";

export const api: Record<string, TinyApiHandler> = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  filePreview: ({ path }, app) => getFilePreviewUrl(path, app),
};

// Defining this handler makes tinyjs start watching the clipboard.
export async function onClipboardChange(
  { self }: { changeCount: number; self: boolean },
  app: TinyApp,
) {
  if (self) return; // our own write, e.g. pasting a history item back
  const item = await readClipboardItem(app);
  if (item) app.push("clipboard-item", item);
}

export function init(app: TinyApp) {
  app.tray.set({ icon: "sf:document.on.clipboard" });
  app.setHideOnClose(true);
}
