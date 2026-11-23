import { ref } from "vue";

import { useClient } from "../client";
import type { PairOptions } from "../types/client";
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
  /** What the last action did, when that is worth saying */
  const notice = ref("");
  if (!isSubscribed) {
    isSubscribed = true;
    void client.getSyncStatus().then((loaded) => (status.value = loaded));
    client.onSyncStatusChanged((changed) => (status.value = changed));
  }

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    isBusy.value = true;
    error.value = "";
    notice.value = "";
    try {
      return await action();
    } catch (caught) {
      error.value = caught instanceof Error ? caught.message : String(caught);
      return undefined;
    } finally {
      isBusy.value = false;
    }
  }

  /** Join the devices whose recovery code or QR link this is. Null when it
   *  didn't join (the reason is in `error`), or with the name of the device
   *  it connected to, if one did straight away. Does nothing with no code, or
   *  while this screen is already joining or turning off. */
  async function join(
    code: string,
    options?: PairOptions,
  ): Promise<{ deviceName: string | null } | null> {
    if (isBusy.value || !code.trim()) return null;
    const result = await run(() => client.pair(code, options));
    if (!result) return null;
    if (!result.ok) {
      error.value = result.error ?? "Couldn't join with that code";
      return null;
    }
    return { deviceName: result.deviceName ?? null };
  }

  async function turnOff(): Promise<void> {
    if (isBusy.value) return;
    const done = await run(async () => {
      await client.unpair();
      return true;
    });
    if (done) {
      notice.value =
        "Sync is off. This phone forgot its sync key and devices; your history stays.";
    }
  }

  /** Stop syncing with one device. Whether it worked; the reason is in
   *  `error` when it didn't. */
  async function disconnect(deviceId: string): Promise<boolean> {
    if (isBusy.value) return false;
    const done = await run(async () => {
      await client.removeDevice(deviceId);
      return true;
    });
    return done === true;
  }

  return { status, isBusy, error, notice, join, turnOff, disconnect };
}
