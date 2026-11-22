import { readonly, ref } from "vue";

import { type LocalAiStatus, localAiStatusEvent } from "@/types/local-ai";

const status = ref<LocalAiStatus | null>(null);
const statusFailed = ref(false);
let subscribed = false;
let pending: Promise<void> | undefined;

export const localAiStatusFailed = readonly(statusFailed);

export function useLocalAi() {
  if (!subscribed) {
    subscribed = true;
    tiny.api.on(localAiStatusEvent, (value: LocalAiStatus) => {
      status.value = value;
      statusFailed.value = false;
    });
    if (!status.value) void refreshLocalAi();
  }
  return readonly(status);
}

export function refreshLocalAi() {
  pending ??= tiny.api
    .call("localAiStatus")
    .then((value: LocalAiStatus) => {
      status.value = value;
      statusFailed.value = false;
    })
    .catch(() => {
      statusFailed.value = true;
    })
    .finally(() => {
      pending = undefined;
    });
  return pending;
}
