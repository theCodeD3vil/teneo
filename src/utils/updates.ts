// A native alert, app-modal rather than tied to a window, so it shows even
// while the panel is hidden
export async function promptToInstallUpdate({
  current,
  latest,
  notes,
}: TinyUpdateInfo) {
  const shouldInstall = await tiny.dialog.confirm(
    `Teneo ${latest} is available`,
    {
      detail: [`You have ${current}.`, notes].filter(Boolean).join("\n\n"),
      ok: "Install and Relaunch",
      cancel: "Later",
    },
  );
  if (shouldInstall) await tiny.api.call("update.install");
}
