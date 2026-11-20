import { readonly, ref } from "vue";

import type { Updater, UpdateState } from "../updates/updater";

// One updater for the whole app, set up in main.ts
let updater: Updater | null = null;
const state = ref<UpdateState>({ kind: "idle" });

export function provideUpdater(instance: Updater): void {
  updater = instance;
  state.value = instance.state;
  instance.onChange((next) => {
    state.value = next;
  });
  // back from Android's settings or its installer (Updater.resumed)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void instance.resumed();
  });
}

/** Whether the app updates itself. Google Play's build doesn't: Play does. */
export function hasUpdater(): boolean {
  return updater !== null;
}

function requireUpdater(): Updater {
  if (!updater) throw new Error("the updater was not set up (main.ts)");
  return updater;
}

export function useUpdates() {
  return {
    state: readonly(state),
    check: () => requireUpdater().check(),
    checkIfDue: () => requireUpdater().checkIfDue(),
    install: () => requireUpdater().install(),
    cancel: () => requireUpdater().cancel(),
    askToNotify: () => requireUpdater().askToNotify(),
    onOpenedFromNotification: (listener: () => void) =>
      requireUpdater().onOpenedFromNotification(listener),
    dismiss: (...args: Parameters<Updater["dismiss"]>) =>
      requireUpdater().dismiss(...args),
  };
}
