import { readonly, ref } from "vue";

import { useClient } from "../client";
import { defaultSettings, type MobileSettings } from "../types/settings";

// One copy for the whole app, loaded once
const settings = ref<MobileSettings>({ ...defaultSettings });
let loadSettings: Promise<void> | null = null;

export function useSettings() {
  const client = useClient();
  loadSettings ??= client.getSettings().then((loaded) => {
    settings.value = loaded;
  });

  // Shown at once; the client's answer replaces it
  async function updateSettings(
    changes: Partial<MobileSettings>,
  ): Promise<void> {
    settings.value = { ...settings.value, ...changes };
    settings.value = await client.updateSettings(changes);
  }

  return { settings: readonly(settings), updateSettings };
}
