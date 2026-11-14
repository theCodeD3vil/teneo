import { readonly, ref } from "vue";

import {
  type AppSettings,
  defaultSettings,
  pickSettings,
  settingsChangedEvent,
} from "../../shared/types/settings";

// One copy per window, kept in sync by the backend's settings-changed push
const settings = ref<AppSettings>({ ...defaultSettings });
let isSubscribed = false;

function applySettings(value: unknown): void {
  settings.value = { ...settings.value, ...pickSettings(value) };
}

function subscribeToSettings(): void {
  if (isSubscribed) return;
  isSubscribed = true;
  // Subscribe before fetching so no change is missed in between. Replies and
  // pushes arrive in the order the backend sent them, so applying both in
  // arrival order always ends on the newest settings.
  tiny.api.on(settingsChangedEvent, applySettings);
  void tiny.api.call("settings").then(applySettings);
}

export function useSettings() {
  subscribeToSettings();

  async function updateSettings(changes: Partial<AppSettings>): Promise<void> {
    applySettings(changes); // optimistic, so switches move instantly
    applySettings(await tiny.api.call("updateSettings", changes));
  }

  return { settings: readonly(settings), updateSettings };
}
