// Opens Teneo's update window. It floats above other apps, so it shows even
// while the panel is hidden
export async function promptToInstallUpdate(update: TinyUpdateInfo) {
  await tiny.api.call("openUpdate", update);
}
