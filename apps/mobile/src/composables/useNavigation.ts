import { onScopeDispose, readonly, ref, watch, type Ref } from "vue";

export type ScreenName =
  | "history"
  | "item-view"
  | "settings"
  | "settings-page"
  | "setup";

export type SettingsPageName = "general" | "sync" | "storage" | "about";

export interface NavigationState {
  screen: ScreenName;
  itemId?: string;
  settingsPage?: SettingsPageName;
  /** how deep this entry is in the app's history, to tell back from forward */
  index: number;
}

export type NavigationDirection = "forward" | "back";

const currentState = ref<NavigationState>({ screen: "history", index: 0 });
const direction = ref<NavigationDirection>("forward");

// Open menus and dialogs, newest last. Each holds a history entry of its own,
// so the back gesture closes it instead of leaving the screen.
const openOverlays: Array<() => void> = [];
// history.back() calls of our own whose popstate is still to come
let pendingBacks = 0;
// a screen opened while one of those is still to come: pushing it now would
// get it popped by that back
let queuedPush: NavigationState | null = null;
// a screen swapped in while one is still to come: swapping now would change
// the entry that back is about to drop, not the one it lands on
let queuedReplace: NavigationState | null = null;
let isInitialized = false;

function pushEntry(state: NavigationState): void {
  direction.value = "forward";
  currentState.value = state;
  window.history.pushState(state, "");
}

function replaceEntry(state: NavigationState): void {
  direction.value = "forward";
  currentState.value = state;
  window.history.replaceState(state, "");
}

function handlePopState(event: PopStateEvent): void {
  if (pendingBacks > 0) {
    pendingBacks -= 1;
    if (pendingBacks === 0 && queuedReplace) {
      const state = queuedReplace;
      queuedReplace = null;
      replaceEntry(state);
    }
    if (pendingBacks === 0 && queuedPush) {
      const state = queuedPush;
      queuedPush = null;
      pushEntry(state);
    }
    return;
  }

  const closeOverlay = openOverlays.pop();
  if (closeOverlay) {
    closeOverlay();
    return;
  }

  const state = (event.state as NavigationState | null) ?? {
    screen: "history",
    index: 0,
  };
  direction.value = state.index < currentState.value.index ? "back" : "forward";
  currentState.value = state;
}

// A screen opened from a menu or sheet closes it first and drops its history
// entries, so back from the new screen doesn't land on a closed menu
function closeOverlays(): void {
  const count = openOverlays.length;
  if (count === 0) return;
  for (const close of openOverlays.splice(0).reverse()) close();
  pendingBacks += 1;
  window.history.go(-count);
}

/** Start on `screen` and follow the back gesture (MainActivity sends it to
 *  the WebView's history). */
export function initNavigation(screen: ScreenName): void {
  if (isInitialized) return;
  isInitialized = true;
  const state: NavigationState = { screen, index: 0 };
  currentState.value = state;
  window.history.replaceState(state, "");
  window.addEventListener("popstate", handlePopState);
}

export function useNavigation() {
  function pushScreen(
    screen: ScreenName,
    details: Pick<NavigationState, "itemId" | "settingsPage"> = {},
  ): void {
    const state = { screen, ...details, index: currentState.value.index + 1 };
    closeOverlays();
    if (pendingBacks > 0) queuedPush = state;
    else pushEntry(state);
  }

  /** Swap the screen without a history entry, e.g. leaving first-run setup */
  function replaceScreen(screen: ScreenName): void {
    const state = { screen, index: currentState.value.index };
    if (pendingBacks > 0) queuedReplace = state;
    else replaceEntry(state);
  }

  function goBack(): void {
    window.history.back();
  }

  return {
    currentState: readonly(currentState),
    direction: readonly(direction),
    openItemView: (itemId: string) => pushScreen("item-view", { itemId }),
    openSettings: () => pushScreen("settings"),
    openSettingsPage: (settingsPage: SettingsPageName) =>
      pushScreen("settings-page", { settingsPage }),
    openSetup: () => pushScreen("setup"),
    replaceScreen,
    goBack,
  };
}

/**
 * Hold the back gesture: the next one calls `onBack` instead of leaving the
 * screen, such as a step back inside first-run setup. It holds one gesture;
 * hold again for the next. The returned function lets go without a gesture,
 * dropping the history entry the hold took.
 */
export function holdBack(onBack: () => void): () => void {
  // a plain copy: history can't clone the reactive proxy
  window.history.pushState({ ...currentState.value }, "");
  let isHeld = true;
  const entry = () => {
    isHeld = false;
    onBack();
  };
  openOverlays.push(entry);
  return () => {
    if (!isHeld) return;
    isHeld = false;
    openOverlays.splice(openOverlays.indexOf(entry), 1);
    pendingBacks += 1;
    window.history.back();
  };
}

/** The back gesture closes this menu or dialog while it's open. */
export function useBackToClose(open: Ref<boolean>): void {
  let close: (() => void) | null = null;

  function release(): void {
    if (!close) return;
    openOverlays.splice(openOverlays.indexOf(close), 1);
    close = null;
    // closed by a tap, not by back: drop the entry it pushed
    pendingBacks += 1;
    window.history.back();
  }

  watch(open, (isOpen) => {
    if (isOpen && !close) {
      // a plain copy: history can't clone the reactive proxy
      window.history.pushState({ ...currentState.value }, "");
      const entry = () => {
        close = null;
        open.value = false;
      };
      close = entry;
      openOverlays.push(entry);
    } else if (!isOpen) {
      release();
    }
  });

  onScopeDispose(release);
}
