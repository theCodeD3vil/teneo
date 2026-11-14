<script setup lang="ts">
import type { SettingsPageName } from "../../composables/useNavigation";
import { settingsPages } from "./pages";
import SettingsHeader from "./SettingsHeader.vue";

defineProps<{
  page: SettingsPageName;
}>();
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SettingsHeader back-label="Back to settings">
      <span class="text-lg font-medium">{{ settingsPages[page].title }}</span>
    </SettingsHeader>
    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
      <component :is="settingsPages[page].content" />
    </div>
  </div>
</template>
