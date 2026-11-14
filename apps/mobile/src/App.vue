<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { onMounted } from "vue";

import { useClient } from "./client";
import ActionSheet from "./components/ActionSheet.vue";
import HistoryScreen from "./components/HistoryScreen.vue";
import ItemViewScreen from "./components/ItemViewScreen.vue";
import SettingsScreen from "./components/SettingsScreen.vue";
import ToastNotification from "./components/ToastNotification.vue";
import WelcomePairingScreen from "./components/WelcomePairingScreen.vue";
import { useNavigation } from "./composables/useNavigation";
import { useToast } from "./composables/useToast";

const client = useClient();
const {
  currentState,
  activeSheetItem,
  closeActionSheet,
  openItemView,
  initNavigation,
} = useNavigation();
const { showToast } = useToast();

onMounted(() => {
  initNavigation();
});

async function handleSheetCopy(item: ClipboardHistoryItem) {
  closeActionSheet();
  await client.copyToClipboard(item.id);
  showToast("Copied to clipboard");
}

function handleSheetView(item: ClipboardHistoryItem) {
  closeActionSheet();
  openItemView(item.id);
}

async function handleSheetTogglePin(item: ClipboardHistoryItem) {
  closeActionSheet();
  const nextPinned = !item.pinned;
  await client.setPinned(item.id, nextPinned);
  showToast(nextPinned ? "Item pinned" : "Item unpinned");
}

async function handleSheetShare(item: ClipboardHistoryItem) {
  closeActionSheet();
  if (item.text && typeof navigator !== "undefined" && navigator.share) {
    try {
      await navigator.share({ text: item.text });
    } catch {
      // User cancelled share
    }
  } else {
    await handleSheetCopy(item);
  }
}

async function handleSheetDelete(item: ClipboardHistoryItem) {
  closeActionSheet();
  await client.deleteItem(item.id);
  showToast("Item deleted");
}
</script>

<template>
  <div class="bg-background text-foreground relative min-h-dvh select-none">
    <!-- Active screen -->
    <HistoryScreen v-if="currentState.screen === 'history'" />

    <ItemViewScreen
      v-else-if="currentState.screen === 'item-view' && currentState.itemId"
      :item-id="currentState.itemId" />

    <SettingsScreen v-else-if="currentState.screen === 'settings'" />

    <WelcomePairingScreen
      v-else-if="currentState.screen === 'pairing'"
      :initial-step="currentState.pairingStep ?? 'scan'" />

    <!-- Action Sheet for items -->
    <ActionSheet
      :item="activeSheetItem"
      :is-open="Boolean(activeSheetItem)"
      @close="closeActionSheet"
      @copy="handleSheetCopy"
      @view="handleSheetView"
      @toggle-pin="handleSheetTogglePin"
      @share="handleSheetShare"
      @delete="handleSheetDelete" />

    <!-- Global Toast Confirmation -->
    <ToastNotification />
  </div>
</template>
