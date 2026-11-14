import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { ref } from "vue";

export type ScreenName = "history" | "item-view" | "settings" | "pairing";

export interface NavigationState {
  screen: ScreenName;
  itemId?: string;
  pairingStep?: "scan" | "manual" | "success";
}

const currentState = ref<NavigationState>({ screen: "history" });
const activeSheetItem = ref<ClipboardHistoryItem | null>(null);

let isInitialized = false;

export function useNavigation() {
  function pushScreen(state: NavigationState) {
    currentState.value = state;
    activeSheetItem.value = null;
    window.history.pushState({ ...state, isAppScreen: true }, "");
  }

  function goBack() {
    if (activeSheetItem.value) {
      activeSheetItem.value = null;
      return;
    }
    if (currentState.value.screen !== "history") {
      window.history.back();
    }
  }

  function openItemView(itemId: string) {
    pushScreen({ screen: "item-view", itemId });
  }

  function openSettings() {
    pushScreen({ screen: "settings" });
  }

  function openPairing(step: "scan" | "manual" | "success" = "scan") {
    pushScreen({ screen: "pairing", pairingStep: step });
  }

  function openActionSheet(item: ClipboardHistoryItem) {
    activeSheetItem.value = item;
  }

  function closeActionSheet() {
    activeSheetItem.value = null;
  }

  function initNavigation() {
    if (isInitialized) return;
    isInitialized = true;

    // Set initial history state if not already set
    if (!window.history.state?.isAppScreen) {
      window.history.replaceState({ screen: "history", isAppScreen: true }, "");
    }

    const handlePopState = (event: PopStateEvent) => {
      if (activeSheetItem.value) {
        activeSheetItem.value = null;
        // Don't change screen if just dismissing the sheet
        return;
      }

      const state = event.state as NavigationState | null;
      if (state && state.screen) {
        currentState.value = {
          screen: state.screen,
          itemId: state.itemId,
          pairingStep: state.pairingStep,
        };
      } else {
        currentState.value = { screen: "history" };
      }
    };

    window.addEventListener("popstate", handlePopState);
  }

  return {
    currentState,
    activeSheetItem,
    pushScreen,
    goBack,
    openItemView,
    openSettings,
    openPairing,
    openActionSheet,
    closeActionSheet,
    initNavigation,
  };
}
