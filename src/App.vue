<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from "vue";

import { openPanelHotkeyId } from "../shared/types/settings";
import { showPanelEvent } from "../shared/types/windows";
import HomeFooter from "./components/HomeFooter.vue";
import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { useHotkeys } from "./composables/useHotkeys";
import { PANEL_WIDTH } from "./constants/system";

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const searchQuery = ref("");

async function toggleWindow() {
  const windowState = await tiny.win.getState();
  if (windowState.visible) {
    await tiny.api.call("hidePanel");
    return;
  }
  await showWindow();
}

// Each visit gets a new TabManager (it opens on All, see its lifecycle hooks).
// Mounting the All list takes ~300ms, and a window shown meanwhile paints the
// old tab first, so it's mounted and laid out while the panel is hidden.
const panelKey = ref(0);
let panelReset: Promise<void> | undefined;

function resetPanel(): Promise<void> {
  panelReset ??= remountPanel();
  return panelReset;
}

async function remountPanel(): Promise<void> {
  panelKey.value++;
  await nextTick();
  void document.body.offsetHeight;
}

// Done as the panel hides, so opening it doesn't wait for the render. Later, so
// a paste that hid the panel isn't held up by it; opening again before then
// resets in showWindow instead.
function resetPanelWhenHidden(): void {
  if (!document.hidden) return;
  setTimeout(() => {
    if (document.hidden) void resetPanel();
  }, 500);
}

async function showWindow() {
  const trayPosition = await tiny.tray.position();

  //exit if we cant get the menubar icon position
  if (!trayPosition) return;

  //position the window under the menubar icon, centered
  const calulatedXPosition =
    trayPosition.x + trayPosition.width / 2 - PANEL_WIDTH / 2;
  const calculatedYPosition = trayPosition.y + trayPosition.height;
  tiny.win.setPosition(calulatedXPosition, calculatedYPosition);

  // Normally done already when the panel was hidden
  await resetPanel();
  panelReset = undefined;
  // Open on the list, not the search field, so letter hotkeys (P, D) work;
  // ⌘ / focuses search. Blur too: focus left in search last time comes back on show.
  searchInput.value?.blur();
  // Put the window on this Space before activating: activating a hidden app
  // with no window on screen makes macOS leave a full-screen Space for a desktop
  await tiny.win.show({ activate: false });
  await tiny.win.show();
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
// Sent when the user finishes the first-launch setup window
let unsubscribeFromShowPanel: (() => void) | undefined;

onMounted(() => {
  window.addEventListener("blur", hideWindowOnBlur);
  document.addEventListener("visibilitychange", resetPanelWhenHidden);
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
  unsubscribeFromHotkeys = tiny.api.on("hotkey", ({ id }: { id: string }) => {
    if (id === openPanelHotkeyId) void toggleWindow();
  });
  unsubscribeFromShowPanel = tiny.api.on(showPanelEvent, showWindow);
});

onUnmounted(() => {
  window.removeEventListener("blur", hideWindowOnBlur);
  document.removeEventListener("visibilitychange", resetPanelWhenHidden);
  unsubscribeFromHotkeys?.();
  unsubscribeFromShowPanel?.();
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
      :key="panelKey"
      :search-query="searchQuery"
      @tab-change="(e: number) => (clipboardItemsCount = e)" />
    <HomeFooter :clipboard-items-count="clipboardItemsCount" />
  </div>
</template>
