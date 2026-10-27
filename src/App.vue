<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";

import { openPanelHotkeyId } from "../shared/types/settings";
import { showPanelEvent } from "../shared/types/windows";
import HomeFooter from "./components/HomeFooter.vue";
import ItemPreview from "./components/ItemPreview.vue";
import SearchInput from "./components/SearchInput.vue";
import TabManager from "./components/TabManager.vue";
import { useClipboard } from "./composables/useClipboard";
import { useHotkeys } from "./composables/useHotkeys";
import { PANEL_WIDTH } from "./constants/system";
import type { ClipboardHistoryItem } from "./types/clipboard";
import { resetPanel, resetPanelEvent } from "./utils/panel-reset";

const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const searchQuery = ref("");
// Space swaps the whole panel for this item's preview. It's looked up by id so
// it follows history refreshes (a pin shows), and closes once it's deleted.
const { clipboardItems } = useClipboard();
const previewedItemId = ref<string | null>(null);
const previewedItem = computed(
  () =>
    clipboardItems.value.find(({ id }) => id === previewedItemId.value) ?? null,
);
watch(previewedItem, (item) => {
  if (!item) closePreview();
});

function openPreview(item: ClipboardHistoryItem): void {
  searchInput.value?.blur(); // a hidden search field would still take keys
  previewedItemId.value = item.id;
}

function closePreview(): void {
  previewedItemId.value = null;
}

// As the panel hides, the list comes back with no slide: a hidden window can
// hold the animation back until it shows again, which would replay it on open
const animatePreview = ref(true);
async function resetPreview(): Promise<void> {
  if (!previewedItemId.value) return;
  animatePreview.value = false;
  closePreview();
  await nextTick();
  animatePreview.value = true;
}

// The preview pushes in from the right and the list slides out left, and back.
// The leaving view is lifted out of the flow so both share the panel mid-swap.
function slideTransition(offsetClass: string) {
  return {
    enterActiveClass:
      "transition-all duration-200 ease-out motion-reduce:transition-none",
    enterFromClass: `${offsetClass} opacity-0`,
    leaveActiveClass:
      "absolute inset-4 transition-all duration-150 ease-in motion-reduce:transition-none",
    leaveToClass: `${offsetClass} opacity-0`,
  };
}
const previewTransition = slideTransition("translate-x-6");
const listTransition = slideTransition("-translate-x-6");

async function toggleWindow() {
  const windowState = await tiny.win.getState();
  if (windowState?.visible) {
    await tiny.api.call("hidePanel");
    resetPanel();
    return;
  }
  await showWindow();
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

  // Normally already on All from when the panel hid, so nothing re-renders here.
  // If not, wait for it: a window shown meanwhile paints the old tab first.
  resetPanel();
  // Open on the list, not the search field, so letter hotkeys (P, D) work;
  // ⌘ / focuses search. Blur too: focus left in search last time comes back on show.
  searchInput.value?.blur();
  await nextTick();
  void document.body.offsetHeight; // lay the list out now, while the window is hidden
  // The main window is a panel (tinyjs.json): show() gives it the keyboard
  // without activating Teneo, so macOS stays on a full-screen Space
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
  if (windowState?.visible && !(await isCursorOverTray())) {
    await tiny.win.hide({ app: false });
    resetPanel();
  }
}

// The global shortcut set in Settings › Hotkeys toggles the panel like the tray icon
let unsubscribeFromHotkeys: (() => void) | undefined;
// Sent when the user finishes the first-launch setup window
let unsubscribeFromShowPanel: (() => void) | undefined;

onMounted(() => {
  window.addEventListener("blur", hideWindowOnBlur);
  tiny.tray.onClick(async () => {
    await toggleWindow();
  });
  unsubscribeFromHotkeys = tiny.api.on("hotkey", ({ id }: { id: string }) => {
    if (id === openPanelHotkeyId) void toggleWindow();
  });
  unsubscribeFromShowPanel = tiny.api.on(showPanelEvent, showWindow);
  window.addEventListener(resetPanelEvent, resetPreview);
});

onUnmounted(() => {
  window.removeEventListener("blur", hideWindowOnBlur);
  unsubscribeFromHotkeys?.();
  unsubscribeFromShowPanel?.();
  window.removeEventListener(resetPanelEvent, resetPreview);
});
const clipboardItemsCount = ref(0);

useHotkeys(
  {
    focusSearch: () => {
      searchInput.value?.focus();
    },
  },
  () => !previewedItem.value,
);
</script>

<template>
  <!-- dark mode tints the vibrancy panel darker; settings and other windows keep the plain panel -->
  <div
    class="relative flex h-screen flex-col overflow-hidden bg-transparent! p-4 dark:bg-black/55!">
    <Transition v-bind="previewTransition" :css="animatePreview">
      <ItemPreview
        v-if="previewedItem"
        :item="previewedItem"
        @back="closePreview" />
    </Transition>
    <!-- hidden, not unmounted, so the list keeps its tab, selection and scroll -->
    <Transition v-bind="listTransition" :css="animatePreview">
      <div v-show="!previewedItem" class="flex min-h-0 flex-1 flex-col gap-3">
        <SearchInput ref="searchInput" v-model="searchQuery" />
        <TabManager
          :search-query="searchQuery"
          :preview-open="!!previewedItem"
          @tab-change="(e: number) => (clipboardItemsCount = e)"
          @preview="openPreview" />
        <HomeFooter :clipboard-items-count="clipboardItemsCount" />
      </div>
    </Transition>
  </div>
</template>
