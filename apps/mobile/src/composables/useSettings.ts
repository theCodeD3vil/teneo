import { readonly, ref } from "vue";

import { useClient } from "../client";
import { defaultSettings, type MobileSettings } from "../types/settings";

// One copy for the whole app, loaded once
const settings = ref<MobileSettings>({ ...defaultSettings });
// what the client last said, and the changes it hasn't answered yet
let saved: MobileSettings = { ...defaultSettings };
const unsaved: Partial<MobileSettings>[] = [];
let loadSettings: Promise<void> | null = null;
// the load and every change go to the client one after another, so an older
// answer never replaces a newer one
let queue: Promise<void> = Promise.resolve();

function show(): void {
  settings.value = Object.assign({}, saved, ...unsaved);
}

export function useSettings() {
  const client = useClient();
  if (!loadSettings) {
    const load = queue.then(async () => {
      saved = await client.getSettings();
      show();
    });
    loadSettings = load;
    queue = load.catch(() => {
      loadSettings = null; // the next use asks again
    });
  }

  /** Shown at once; put back if the client can't save it. Never rejects. */
  function updateSettings(changes: Partial<MobileSettings>): Promise<void> {
    unsaved.push(changes);
    show();
    queue = queue
      .then(async () => {
        saved = await client.updateSettings(changes);
      })
      .catch(() => undefined) // not saved: `show` below puts it back
      .then(() => {
        unsaved.splice(unsaved.indexOf(changes), 1);
        show();
      });
    return queue;
  }

  return { settings: readonly(settings), updateSettings };
}
