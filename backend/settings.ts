// Settings live in memory for synchronous reads (e.g. on every clipboard
// change) and are written through to tinyjs's store.
import {
  type AppSettings,
  defaultSettings,
  pickSettings,
  settingsChangedEvent,
} from "../shared/types/settings";

const settingsStoreKey = "settings";

let currentSettings: AppSettings = { ...defaultSettings };

export async function loadSettings(app: TinyApp): Promise<void> {
  const storedSettings = await app.store.get(settingsStoreKey);
  currentSettings = { ...defaultSettings, ...pickSettings(storedSettings) };
}

export function getSettings(): AppSettings {
  return currentSettings;
}

/** Apply a partial change, persist it, and tell every window. */
export async function updateSettings(
  changes: unknown,
  app: TinyApp,
): Promise<AppSettings> {
  currentSettings = { ...currentSettings, ...pickSettings(changes) };
  await app.store.set(settingsStoreKey, currentSettings);
  app.push(settingsChangedEvent, currentSettings);
  return currentSettings;
}
