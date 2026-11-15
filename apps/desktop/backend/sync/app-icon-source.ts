// The icons this Mac hands to a phone that asks. An item travels with its
// app's name only, so the phone asks by name: the icon is the one saved for
// the app this Mac last saw copy under that name (app-icons.ts).
import type { Bytes } from "@teneo/sync";

import { saveAppIcon } from "../app-icons";
import { initializeDatabase } from "../database";
import { all } from "../sqlite";

/** The png of the app with this name, or null when nothing was copied from
 *  one here, or the app is gone and its icon was never saved. */
export async function appIconPng(
  name: string,
  app: TinyApp,
): Promise<Bytes | null> {
  const [copied] = all<{ bundleId: string }>(
    await initializeDatabase(app),
    `
      SELECT sourceAppBundleId AS bundleId FROM "CLIPBOARD_ITEMS"
      WHERE sourceAppName = ? AND sourceAppBundleId IS NOT NULL
      ORDER BY dateCopied DESC LIMIT 1
    `,
    name,
  );
  if (!copied) return null;
  const iconPath = await saveAppIcon(copied.bundleId, app);
  // a copy: tjs hands back bytes over a buffer that may be shared
  return iconPath ? new Uint8Array(await tjs.readFile(iconPath)) : null;
}
