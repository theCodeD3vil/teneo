import { useEventListener } from "@vueuse/core";
import { onMounted, ref } from "vue";

// Accessibility lets Teneo post ⌘V to paste into other apps
export function useAccessibilityPermission() {
  const status = ref<TinyPermissionStatus | null>(null);

  async function refresh(): Promise<void> {
    status.value = await tiny.app.permissions.check("accessibility");
  }

  // Opens System Settings at Teneo's switch
  async function request(): Promise<void> {
    await tiny.app.permissions.request("accessibility");
    await refresh();
  }

  onMounted(refresh);
  // Access is granted in System Settings, so re-check when the user comes back
  useEventListener(window, "focus", refresh);

  return { status, refresh, request };
}
