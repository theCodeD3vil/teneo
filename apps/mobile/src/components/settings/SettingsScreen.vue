<script setup lang="ts">
import { cn } from "@teneo/ui/lib/utils";
import { computed } from "vue";
import ChevronIcon from "~icons/tabler/chevron-right";

import logoUrl from "../../assets/logo.svg";
import {
  type SettingsPageName,
  useNavigation,
} from "../../composables/useNavigation";
import { useSyncStatus } from "../../composables/useSyncStatus";
import { useUpdates } from "../../composables/useUpdates";
import { settingsPages } from "./pages";
import SettingsHeader from "./SettingsHeader.vue";
import SettingsSection from "./SettingsSection.vue";

const { openSettingsPage } = useNavigation();
const { status } = useSyncStatus();
const { state: updateState } = useUpdates();

const syncSummary = computed(() => {
  const state = status.value?.state;
  if (!state || state === "off" || state === "not_paired") return "Off";
  if (state !== "connected") return "On";
  const count = status.value?.devices.length ?? 0;
  return count === 1 ? "1 device" : `${count} devices`;
});

const summaries = computed<Record<SettingsPageName, string>>(() => ({
  general: "Clipboard, API keys",
  sync: syncSummary.value,
  storage: "History, item limit",
  about:
    "update" in updateState.value
      ? "Update available"
      : `Version ${__APP_VERSION__}`,
}));

const groups: SettingsPageName[][] = [
  ["general", "sync", "storage"],
  ["about"],
];
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SettingsHeader back-label="Back to clipboard history">
      <img class="aspect-square size-8" :src="logoUrl" alt="" />
      <span class="text-lg font-medium">Teneo</span>
    </SettingsHeader>
    <div
      class="mx-auto grid min-h-0 w-full max-w-xl flex-1 content-start gap-y-6 overflow-y-auto overscroll-contain pb-4">
      <SettingsSection v-for="(group, index) in groups" :key="index">
        <button
          v-for="name in group"
          :key="name"
          type="button"
          class="active:bg-foreground/5 dark:active:bg-foreground/6 flex w-full items-center gap-x-3 px-3 py-3 text-left transition-colors first:rounded-t-lg last:rounded-b-lg"
          @click="openSettingsPage(name)">
          <span :class="cn('rounded-md p-1.5', settingsPages[name].iconClass)">
            <component :is="settingsPages[name].icon" class="size-4" />
          </span>
          <span class="text-foreground/80 flex-1 text-sm">
            {{ settingsPages[name].title }}
          </span>
          <span class="text-foreground/50 truncate text-xs">
            {{ summaries[name] }}
          </span>
          <ChevronIcon class="text-foreground/40 size-4 shrink-0" />
        </button>
      </SettingsSection>
    </div>
  </div>
</template>
