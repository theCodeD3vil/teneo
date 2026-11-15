<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { ref } from "vue";
import BetaIcon from "~icons/tabler/flask";
import WaveIcon from "~icons/tabler/ripple";
import DebugIcon from "~icons/tabler/tool";

import { useKeyboard } from "../../composables/useKeyboard";
import { useNavigation } from "../../composables/useNavigation";
import type { TabVariant } from "../../types/tabs";
import HomeFooter from "./HomeFooter.vue";
import SearchInput from "./SearchInput.vue";
import TabManager from "./TabManager.vue";

// Which build this is. Capacitor marks a debug build for the page; the
// browser's dev server counts as one too. A beta has it in its version.
const isDebugBuild =
  import.meta.env.DEV ||
  (window as { Capacitor?: { DEBUG?: boolean } }).Capacitor?.DEBUG === true;
const badge = isDebugBuild
  ? { icon: DebugIcon, class: "bg-warning text-warning-foreground" }
  : __APP_VERSION__.includes("-beta.")
    ? {
        icon: BetaIcon,
        class: "bg-success dark:text-success-foreground text-white",
      }
    : { icon: WaveIcon, class: "bg-primary text-primary-foreground" };

const { openItemView } = useNavigation();
// The keyboard shortens the window, which would lift the footer to sit on
// top of it. While typing, the footer steps aside and the list has the room.
const { isKeyboardOpen } = useKeyboard();
const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const searchQuery = ref("");
const isSearchOpen = ref(false);
const selectedTab = ref<TabVariant>("all");
const clipboardItemsCount = ref(0);

function openPreview(item: ClipboardHistoryItem): void {
  searchInput.value?.blur();
  openItemView(item.id);
}
</script>

<template>
  <!-- The dock is placed against the inner box. The outer one stays free of
       a position of its own: the screen transition makes it absolute as it
       leaves, and a position set here would win over that. -->
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="relative flex min-h-0 flex-1 flex-col">
      <header class="relative h-[3.5rem] shrink-0 px-2">
        <!-- the search field opens over the title -->
        <div
          class="flex h-full items-center gap-3 transition-opacity duration-200"
          :class="isSearchOpen && 'opacity-0'">
          <div class="flex min-w-0 flex-col gap-1">
            <h1
              class="font-heading flex items-center gap-2 text-[1.75rem] leading-[2rem] font-medium tracking-[-0.01em]">
              Hi Tenerean
              <!-- a round badge that tells the builds apart: a wrench on
                   orange for a debug build, a beaker on green for a beta, a
                   wave on the accent colour for a full release -->
              <span
                class="grid size-[2rem] shrink-0 place-items-center rounded-full"
                :class="badge.class"
                aria-hidden="true">
                <component :is="badge.icon" class="size-[1.375rem]" />
              </span>
            </h1>
            <span
              class="text-muted-foreground text-[0.8125rem] leading-[1.125rem]">
              {{ clipboardItemsCount }}
              {{ clipboardItemsCount === 1 ? "item" : "items" }}
            </span>
          </div>
        </div>
        <SearchInput
          ref="searchInput"
          v-model="searchQuery"
          v-model:open="isSearchOpen" />
      </header>
      <TabManager
        v-model:tab="selectedTab"
        :search-query="searchQuery"
        @tab-change="(count: number) => (clipboardItemsCount = count)"
        @preview="openPreview" />
      <HomeFooter v-show="!isKeyboardOpen" v-model:tab="selectedTab" />
    </div>
  </div>
</template>
