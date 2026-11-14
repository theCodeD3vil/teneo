import {
  type PairingInfo,
  type SyncStatus,
  syncStatusChangedEvent,
} from "@teneo/shared/types/sync";
import { readonly, ref } from "vue";

// One copy per window, kept current by the backend's sync-status push. Null
// until the backend has answered.
const status = ref<SyncStatus | null>(null);
let isSubscribed = false;

function subscribeToSyncStatus(): void {
  if (isSubscribed) return;
  isSubscribed = true;
  // Subscribe before asking, so no change is missed in between; replies and
  // pushes arrive in the order the backend sent them
  tiny.api.on(syncStatusChangedEvent, (value: SyncStatus) => {
    status.value = value;
  });
  void tiny.api
    .call("syncStatus")
    .then((value: SyncStatus) => {
      status.value = value;
    })
    // no status, no Sync tab: the rest of settings works without it
    .catch(() => undefined);
}

/** What a failed api call says, for the user. */
export function messageOf(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return typeof error === "string" && error ? error : "Something went wrong.";
}

export function useSyncStatus() {
  subscribeToSyncStatus();

  const isBusy = ref(false);
  const error = ref("");

  /** Run a change; true when it worked, else the reason is in `error`. */
  async function change(call: () => Promise<SyncStatus>): Promise<boolean> {
    isBusy.value = true;
    error.value = "";
    try {
      status.value = await call();
      return true;
    } catch (caught) {
      error.value = messageOf(caught);
      return false;
    } finally {
      isBusy.value = false;
    }
  }

  return {
    status: readonly(status),
    isBusy: readonly(isBusy),
    error: readonly(error),
    turnOn: () => change(() => tiny.api.call("syncTurnOn")),
    join: (code: string) => change(() => tiny.api.call("syncJoin", { code })),
    turnOff: () => change(() => tiny.api.call("syncTurnOff")),
    setSyncSecrets: (enabled: boolean) =>
      change(() => tiny.api.call("setSyncSecrets", { enabled })),
    pairingInfo: (): Promise<PairingInfo> => tiny.api.call("syncPairingInfo"),
  };
}
