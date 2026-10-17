// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
import { getAppIconUrl } from "./app-icons";
import { readClipboardItem } from "./clipboard-history";
import {
  initializeDatabase,
  listClipboardItems,
  saveClipboardItem,
} from "./database";
import { getFilePreview } from "./file-previews";

export const api: Record<string, TinyApiHandler> = {
  appIcon: ({ bundleId }, app) => getAppIconUrl(bundleId, app),
  clipboardItems: (_parameters, app) => listClipboardItems(app),
  filePreview: ({ path }, app) => getFilePreview(path, app),
};

// Defining this handler makes tinyjs start watching the clipboard.
export async function onClipboardChange(
  { self }: { changeCount: number; self: boolean },
  app: TinyApp,
) {
  if (self) return; // our own write, e.g. pasting a history item back
  const item = await readClipboardItem(app);
  if (item) await saveClipboardItem(item, app);
}

export async function init(app: TinyApp) {
  await initializeDatabase(app);
  app.tray.set({ icon: "sf:sparkles.square.filled.on.square" });
  app.setHideOnClose(true);
}
