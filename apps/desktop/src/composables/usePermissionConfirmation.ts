import { shallowRef } from "vue";

export interface PermissionExplanation {
  title: string;
  description: string;
  action: string;
}

export function usePermissionConfirmation() {
  const prompt = shallowRef<PermissionExplanation | null>(null);
  let request: (() => unknown) | undefined;

  function explain(
    explanation: PermissionExplanation,
    proceed: () => unknown,
  ): void {
    request = proceed;
    prompt.value = explanation;
  }

  function cancel(): void {
    request = undefined;
    prompt.value = null;
  }

  function confirm(): void {
    const proceed = request;
    cancel();
    void proceed?.();
  }

  return { prompt, explain, cancel, confirm };
}

export const folderExplanation =
  "Teneo will remember this folder for thumbnails and sizes of files you copy. macOS may ask for access if it hasn’t already been granted.";

export const loginExplanation: PermissionExplanation = {
  title: "Open Teneo at login?",
  description:
    "A login item starts Teneo automatically to keep saving history.",
  action: "Allow at login",
};
