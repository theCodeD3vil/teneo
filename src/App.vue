<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";

import HomeFooter from "./components/HomeFooter.vue";
import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { useHotkeys } from "./composables/useHotkeys";
import { PANEL_WIDTH } from "./constants/system";

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const tabManager = ref<InstanceType<typeof TabManager> | null>(null);
const searchQuery = ref("");

async function toggleWindow() {
  const windowState = await tiny.win.getState();
  const trayPosition = await tiny.tray.position();

  if (windowState.visible) {
    await tiny.win.hide();
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
  // Clicking the tray icon also blurs the window; the tray click handles closing
  if (windowState.visible && !(await isCursorOverTray())) await tiny.win.hide();
}

onMounted(() => {
  window.addEventListener("blur", hideWindowOnBlur);
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
});

onUnmounted(() => {
  window.removeEventListener("blur", hideWindowOnBlur);
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
