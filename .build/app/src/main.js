// ../../../../../../../Users/michaelnji/Projects/desktop-apps/teneo/backend/main.ts
var api = {};
function init(app) {
  app.tray.set({ icon: "sf:document.on.clipboard" });
  app.setHideOnClose(true);
}
export {
  api,
  init
};
