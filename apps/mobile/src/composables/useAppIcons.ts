import { reactive } from "vue";

import { useClient } from "../client";

// One copy for the whole app: the icon of each Mac app by its name, or null
// when the phone has none yet. Sync asks a Mac for the ones it lacks, and the
// client says when one has come.
const icons = reactive(new Map<string, string | null>());
// names asked for since the last round trip: a screen of cards asks together
let waiting = new Set<string>();
// names asked for and not yet answered
const pending = new Set<string>();
let isListening = false;

export function useAppIcons() {
  const client = useClient();

  if (!isListening) {
    isListening = true;
    // an icon came: the apps that had none are worth asking for again
    client.onAppIconsChanged(() => {
      const without = [...icons].filter(([, icon]) => icon === null);
      for (const [name] of without) ask(name);
    });
  }

  function ask(name: string): void {
    if (pending.has(name)) return;
    if (waiting.size === 0) queueMicrotask(load);
    waiting.add(name);
    pending.add(name);
  }

  function load(): void {
    const names = [...waiting];
    waiting = new Set();
    void client
      .getAppIcons(names)
      .then((found) => {
        for (const name of names) icons.set(name, found[name] ?? null);
      })
      .catch(() => undefined) // the cards keep the name alone
      .finally(() => {
        for (const name of names) pending.delete(name);
      });
  }

  /** The icon of the app with this name, once it's known; null until then,
   *  and for an app the phone has no icon for (and for the phone itself). */
  function appIcon(name: string | null | undefined): string | null {
    if (!name) return null;
    const icon = icons.get(name);
    if (icon === undefined) ask(name);
    return icon ?? null;
  }

  return { appIcon };
}
