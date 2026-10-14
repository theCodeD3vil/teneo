// tinyjs backend — full system access via txiki.js (the 'tjs' global).
// Every api method is callable from the page: await tiny.api.call('hello', {...})
export const api: Record<string, TinyApiHandler> = {};

export function init(app: TinyApp) {
  app.tray.set({ icon: "sf:document.on.clipboard" });
  app.setHideOnClose(true);
}
