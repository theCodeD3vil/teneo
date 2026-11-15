<script setup lang="ts">
import { computed, ref, watch } from "vue";

import HistoryScreen from "./components/history/HistoryScreen.vue";
import ItemViewScreen from "./components/preview/ItemViewScreen.vue";
import SettingsPageScreen from "./components/settings/SettingsPageScreen.vue";
import SettingsScreen from "./components/settings/SettingsScreen.vue";
import SetupScreen from "./components/setup/SetupScreen.vue";
import UpdatePrompt from "./components/UpdatePrompt.vue";
import { useNavigation } from "./composables/useNavigation";
import { useSheetDepth } from "./composables/useSheetDepth";

const { currentState, direction } = useNavigation();

// Behind an open sheet the page steps back a touch: it shrinks by a few
// pixels on each side, over a black backdrop. Dragging the sheet down brings
// it forward with the finger.
// Only the transform animates, on the compositor and in step with the sheet
// (the timings of sheet-in and sheet-out in style.css). The page keeps its own
// layer, so nothing is repainted as the animation starts or ends.
const { depth, isDragging } = useSheetDepth();
const sheetEasing = "cubic-bezier(0.32, 0.72, 0, 1)";
const pageScale = 0.02;
const pageDuration = ref(250);
watch(depth, (value, previous) => {
  pageDuration.value = value >= previous ? 250 : 200;
});
const pageDepthStyle = computed(() => ({
  transition: isDragging.value
    ? "none"
    : `transform ${pageDuration.value}ms ${sheetEasing}`,
  transform: `scale(${1 - pageScale * depth.value})`,
}));

// A screen opened pushes in from the right while the one under it slides out
// left, and back the other way, as the desktop preview does. The leaving
// screen is lifted out of the flow so both share the window mid-swap.
const screenTransition = computed(() => {
  const isForward = direction.value === "forward";
  return {
    enterActiveClass:
      "transition-all duration-200 ease-out motion-reduce:transition-none",
    enterFromClass: `${isForward ? "translate-x-6" : "-translate-x-6"} opacity-0`,
    leaveActiveClass:
      "absolute inset-4 transition-all duration-150 ease-in motion-reduce:transition-none",
    leaveToClass: `${isForward ? "-translate-x-6" : "translate-x-6"} opacity-0`,
  };
});

const screenKey = computed(() =>
  [
    currentState.value.screen,
    currentState.value.itemId,
    currentState.value.settingsPage,
  ].join("-"),
);
</script>

<template>
  <div class="h-dvh overflow-hidden bg-black">
    <div
      class="pt-safe pb-safe px-safe bg-background size-full overflow-hidden will-change-transform"
      :style="pageDepthStyle">
      <div class="relative flex size-full flex-col p-4">
        <!-- hidden, not unmounted, so the list keeps its tab, search and scroll -->
        <Transition v-bind="screenTransition">
          <HistoryScreen v-show="currentState.screen === 'history'" />
        </Transition>
        <Transition v-bind="screenTransition">
          <ItemViewScreen
            v-if="currentState.screen === 'item-view' && currentState.itemId"
            :key="screenKey"
            :item-id="currentState.itemId" />
          <SettingsScreen
            v-else-if="currentState.screen === 'settings'"
            key="settings" />
          <SettingsPageScreen
            v-else-if="
              currentState.screen === 'settings-page' &&
              currentState.settingsPage
            "
            :key="screenKey"
            :page="currentState.settingsPage" />
          <SetupScreen
            v-else-if="currentState.screen === 'setup'"
            key="setup" />
        </Transition>
      </div>
    </div>
    <UpdatePrompt />
  </div>
</template>
