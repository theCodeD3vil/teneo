import { useEventListener } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";

// Launch at login is system state (a login item), not a stored setting
export function useLaunchAtLogin() {
  const status = ref<TinyLoginStatus | null>(null);
  const isEnabled = computed({
    get: () => status.value === "enabled",
    set: async (enabled) => {
      status.value = await tiny.app.launchAtLogin.set(enabled);
    },
  });

  async function refresh(): Promise<void> {
    status.value = await tiny.app.launchAtLogin.get();
  }

  onMounted(refresh);
  // Login items are approved in System Settings, so re-check when the user comes back
  useEventListener(window, "focus", refresh);

  return { status, isEnabled };
}
