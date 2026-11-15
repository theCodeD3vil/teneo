import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { reactive, watch } from "vue";

import { useClient } from "../client";
import { useSettings } from "./useSettings";

// One copy for the whole app: a link's icon, or null when its site has none.
// The client keeps them between runs; this only spares the cards a wait.
const icons = reactive(new Map<string, string | null>());
// when each link was last asked for, answered or not
const askedAt = new Map<string, number>();
/** a site that couldn't be reached is asked again after this */
const retryAfterMs = 60_000;
/** a long scroll through history shouldn't keep every icon in memory */
const maxIcons = 300;
let isWatchingSetting = false;

export function useLinkPreviews() {
  const client = useClient();
  const { settings } = useSettings();

  if (!isWatchingSetting) {
    isWatchingSetting = true;
    // what was answered while previews were off is "none": ask again
    watch(
      () => settings.value.showLinkPreviews,
      () => {
        icons.clear();
        askedAt.clear();
      },
    );
  }

  function load(url: string): void {
    const last = askedAt.get(url);
    if (last !== undefined && Date.now() - last < retryAfterMs) return;
    askedAt.set(url, Date.now());
    void client
      .getLinkPreview(url)
      .then((icon) => {
        if (askedAt.get(url) === undefined) return; // the setting changed
        if (icons.size >= maxIcons) {
          const oldest = icons.keys().next().value;
          if (oldest !== undefined) {
            icons.delete(oldest);
            askedAt.delete(oldest);
          }
        }
        icons.set(url, icon);
      })
      .catch(() => undefined); // not reached: asked again later
  }

  /** The icon of a link item's site, once it has loaded. Null for anything
   *  else, while it loads, and when previews are off: the card then shows
   *  its link icon. */
  function linkIcon(item: ClipboardHistoryItem): string | null {
    const url = item.link?.url;
    if (!url || !settings.value.showLinkPreviews) return null;
    const icon = icons.get(url);
    if (icon === undefined) load(url);
    return icon ?? null;
  }

  return { linkIcon };
}
