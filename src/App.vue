<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

import { openPanelHotkeyId } from "../shared/types/settings";
import HomeFooter from "./components/HomeFooter.vue";
import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { useHotkeys } from "./composables/useHotkeys";
import { PANEL_WIDTH } from "./constants/system";
import { promptToInstallUpdate } from "./utils/updates";

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const tabManager = ref<InstanceType<typeof TabManager> | null>(null);
const searchQuery = ref("");

async function toggleWindow() {
  const windowState = await tiny.win.getState();
  const trayPosition = await tiny.tray.position();

  if (windowState.visible) {
    await tiny.api.call("hidePanel");
    return;
  }

  //exit if we cant get the menubar icon position
  if (!trayPosition) return;

  //position the window under the menubar icon, centered
  const calulatedXPosition =
    trayPosition.x + trayPosition.width / 2 - PANEL_WIDTH / 2;
  const calculatedYPosition = trayPosition.y + trayPosition.height;
  tiny.win.setPosition(calulatedXPosition, calculatedYPosition);

  tabManager.value?.activateFirstItem();
  await tiny.win.show();
  searchInput.value?.focus();
}

async function isCursorOverTray(): Promise<boolean> {
  const [trayPosition, mouse] = await Promise.all([
    tiny.tray.position(),
    tiny.app.mousePosition(),
  ]);
  if (!trayPosition) return false;
  return (
    mouse.x >= trayPosition.x &&
    mouse.x <= trayPosition.x + trayPosition.width &&
    mouse.y >= trayPosition.y &&
    mouse.y <= trayPosition.y + trayPosition.height
  );
}

async function hideWindowOnBlur(): Promise<void> {
  const windowState = await tiny.win.getState();
  // Clicking the tray icon also blurs the window; the tray click handles closing.
  // Focus already left, so hide only the panel: a bare hide() hides the whole
  // app, settings window included.
  if (windowState.visible && !(await isCursorOverTray())) {
    await tiny.win.hide({ app: false });
  }
}

// The global shortcut set in Settings › Hotkeys toggles the panel like the tray icon
let unsubscribeFromHotkeys: (() => void) | undefined;
// Packaged builds check for updates shortly after launch ("update" in tinyjs.json)
let unsubscribeFromUpdates: (() => void) | undefined;

onMounted(() => {
  window.addEventListener("blur", hideWindowOnBlur);
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
  unsubscribeFromHotkeys = tiny.api.on("hotkey", ({ id }: { id: string }) => {
    if (id === openPanelHotkeyId) void toggleWindow();
  });
  unsubscribeFromUpdates = tiny.api.on(
    "update-available",
    promptToInstallUpdate,
  );
});

onUnmounted(() => {
  window.removeEventListener("blur", hideWindowOnBlur);
  unsubscribeFromHotkeys?.();
  unsubscribeFromUpdates?.();
});
const clipboardItemsCount = ref(0);

useHotkeys({
  focusSearch: () => {
    searchInput.value?.focus();
  },
});
</script>

<template>
  <div class="flex h-screen flex-col gap-3 overflow-hidden bg-transparent! p-4">
    <SearchInput ref="searchInput" v-model="searchQuery" />
    <TabManager
      ref="tabManager"
      :search-query="searchQuery"
      @tab-change="(e: number) => (clipboardItemsCount = e)" />
    <HomeFooter :clipboard-items-count="clipboardItemsCount" />
  </div>
</template>
