<script setup lang="ts">
import { onMounted, ref } from "vue";

import HomeFooter from "./components/HomeFooter.vue";
import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { useHotkeys } from "./composables/useHotkeys";
import { PANEL_WIDTH } from "./constants/system";
import type { TabVariant } from "./types/clipboard";

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const tabManager = ref<InstanceType<typeof TabManager> | null>(null);
const nextTab = ref<TabVariant | null>(null);
const searchQuery = ref("");

function setNextTab(tab: TabVariant | null): void {
  nextTab.value = tab;
}

async function toggleWindow() {
  const windowState = await tiny.win.getState();
  const isWindowVisible = windowState.visible;
  const trayPosition = await tiny.tray.position();

  //hide the window if visible
  if (isWindowVisible) {
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
}

onMounted(() => {
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
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
      @tab-change="(e: number) => (clipboardItemsCount = e)"
      @tab-navigation="setNextTab" />
    <HomeFooter
      :clipboard-items-count="clipboardItemsCount"
      :next-tab="nextTab" />
  </div>
</template>
