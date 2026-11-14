import { ref } from "vue";

import { useClient } from "../client";
import type { SyncStatus } from "../types/sync";

const status = ref<SyncStatus | null>(null);
let isSubscribed = false;

/**
 * This phone's sync with the user's other devices, kept current. The status
 * is one for the whole app; `isBusy` and `error` belong to the screen that
 * asked, so what went wrong on one screen doesn't show on another.
 */
export function useSyncStatus() {
  const client = useClient();
  const isBusy = ref(false);
  const error = ref("");
  if (!isSubscribed) {
    isSubscribed = true;
    void client.getSyncStatus().then((loaded) => (status.value = loaded));
    client.onSyncStatusChanged((changed) => (status.value = changed));
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    isBusy.value = true;
    error.value = "";
    try {
      return await action();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      return undefined;
    } finally {
      isBusy.value = false;
    }
  }

  /** Join the devices whose recovery code or QR link this is. Does nothing
   *  with no code, or while this screen is already joining or turning off. */
  async function join(code: string): Promise<string | null> {
    if (isBusy.value || !code.trim()) return null;
    const result = await run(() => client.pair(code));
    if (!result) return null;
    if (!result.ok) {
      error.value = result.error ?? "Couldn't join with that code";
      return null;
    }
    return result.deviceName ?? "your Mac";
  }

  async function turnOff(): Promise<void> {
    if (isBusy.value) return;
    await run(() => client.unpair());
  }

  return { status, isBusy, error, join, turnOff };
}
