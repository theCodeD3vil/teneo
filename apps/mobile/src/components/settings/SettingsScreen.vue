<script setup lang="ts">
import { cn } from "@teneo/ui/lib/utils";
import { computed } from "vue";
import OpenIcon from "~icons/tabler/arrow-up-right";

import logoUrl from "../../assets/logo.svg";
import {
  type SettingsPageName,
  useNavigation,
} from "../../composables/useNavigation";
import { useSyncStatus } from "../../composables/useSyncStatus";
import { useUpdates } from "../../composables/useUpdates";
import { settingsPages } from "./pages";
import SettingsHeader from "./SettingsHeader.vue";

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
    "update" in updateState.value && updateState.value.update
      ? "Update available"
      : `Version ${__APP_VERSION__}`,
}));

const pages: SettingsPageName[] = ["general", "sync", "storage", "about"];
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SettingsHeader back-label="Back to clipboard history">
      <img class="aspect-square size-[2.75rem]" :src="logoUrl" alt="" />
      <span class="screen-title">Teneo</span>
    </SettingsHeader>
    <div
      class="mx-auto grid min-h-0 w-full max-w-xl flex-1 grid-cols-2 content-start gap-3 overflow-y-auto overscroll-contain pb-4">
      <button
        v-for="name in pages"
        :key="name"
        type="button"
        :class="
          cn(
            'flex h-[10.75rem] flex-col justify-between rounded-[2rem] p-[1.125rem] text-left transition-transform active:scale-[0.97]',
            settingsPages[name].tileClass,
          )
        "
        @click="openSettingsPage(name)">
        <span class="flex items-start justify-between">
          <span
            :class="
              cn(
                'bg-card grid size-[2.75rem] place-items-center rounded-[0.875rem]',
                settingsPages[name].inkClass,
              )
            ">
            <component :is="settingsPages[name].icon" class="size-[1.375rem]" />
          </span>
          <OpenIcon
            :class="cn('size-[1.25rem]', settingsPages[name].subClass)" />
        </span>
        <span class="flex min-w-0 flex-col gap-0.5">
          <span
            class="font-heading text-[1.375rem] leading-[1.75rem] font-semibold">
            {{ settingsPages[name].title }}
          </span>
          <span
            :class="
              cn(
                'truncate text-[0.875rem] leading-[1.25rem]',
                settingsPages[name].subClass,
              )
            ">
            {{ summaries[name] }}
          </span>
        </span>
      </button>
    </div>
  </div>
</template>
