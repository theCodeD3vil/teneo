import { onMounted, onUnmounted, ref } from "vue";

import type { HistoryProtectionStatus } from "../../backend/history-key-envelope";

export function useHistoryProtection() {
  const status = ref<HistoryProtectionStatus | null>(null);
  const busy = ref(false);
  const error = ref("");
  const refresh = () =>
    tiny.api
      .call("historyProtectionStatus")
      .then((value: HistoryProtectionStatus) => {
        status.value = value;
      })
      .catch(() => undefined);

  let unsubscribe: (() => void) | undefined;
  onMounted(() => {
    unsubscribe = tiny.api.on("history-protection-changed", refresh);
    void refresh();
  });
  onUnmounted(() => unsubscribe?.());

  async function change(
    run: () => Promise<HistoryProtectionStatus>,
  ): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    error.value = "";
    try {
      status.value = await run();
    } catch (caught) {
      error.value =
        caught instanceof Error
          ? caught.message
          : typeof caught === "string"
            ? caught
            : "Teneo couldn't finish the change.";
      await refresh();
    } finally {
      busy.value = false;
    }
  }

  return {
    status,
    busy,
    error,
    protect: (requireAuthentication: boolean) =>
      change(() =>
        tiny.api.call("protectHistorySecrets", { requireAuthentication }),
      ),
    unlock: () => change(() => tiny.api.call("unlockHistorySecrets")),
    restore: () => change(() => tiny.api.call("restoreSecretHistoryAccess")),
    lock: () => change(() => tiny.api.call("lockHistorySecrets")),
  };
}
