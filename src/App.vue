<script setup lang="ts">
import { onMounted } from "vue";

import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { PANEL_WIDTH } from "./constants/system";

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

  await tiny.win.show();
}

onMounted(() => {
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
});
</script>

<template>
  <div class="space-y-3 p-3">
    <SearchInput />
    <TabManager />
  </div>
</template>
