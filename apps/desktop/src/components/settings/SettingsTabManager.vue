<script setup lang="ts">
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@teneo/ui/components/tabs";
import { computed, ref } from "vue";
import HardDriveIcon from "~icons/tabler/database";
import InformationCircleIcon from "~icons/tabler/info-circle";
import KeyboardIcon from "~icons/tabler/keyboard";
import SyncIcon from "~icons/tabler/refresh";
import SettingsIcon from "~icons/tabler/settings";
import ShieldIcon from "~icons/tabler/shield";
import SparklesIcon from "~icons/tabler/sparkles";

import { useLocalAi } from "@/composables/useLocalAi";
import { useSyncStatus } from "@/composables/useSyncStatus";

import AboutTab from "./AboutTab.vue";
import GeneralTab from "./GeneralTab.vue";
import HotkeysTab from "./HotkeysTab.vue";
import LocalAiTab from "./LocalAiTab.vue";
import SecurityTab from "./SecurityTab.vue";
import StorageTab from "./StorageTab.vue";
import SyncTab from "./SyncTab.vue";

const allTabs = [
  { value: "general", icon: SettingsIcon, content: GeneralTab },
  { value: "security", icon: ShieldIcon, content: SecurityTab },
  { value: "hotkeys", icon: KeyboardIcon, content: HotkeysTab },
  { value: "storage", icon: HardDriveIcon, content: StorageTab },
  { value: "sync", icon: SyncIcon, content: SyncTab },
  {
    value: "local-ai",
    label: "Local AI",
    icon: SparklesIcon,
    content: LocalAiTab,
  },
  { value: "about", icon: InformationCircleIcon, content: AboutTab },
] as const;

type SettingsTab = (typeof allTabs)[number]["value"];

// The tab shows when the backend says sync is on for this run: it is, unless
// the app was started with TENEO_SYNC=0
const { status: syncStatus } = useSyncStatus();
const localAi = useLocalAi();
const settingsTabs = computed(() =>
  allTabs.filter((tab) => {
    if (tab.value === "sync") return syncStatus.value?.available;
    if (tab.value === "local-ai")
      return import.meta.env.DEV || localAi.value?.available;
    return true;
  }),
);

const selectedTab = ref<SettingsTab>("general");
</script>

<template>
  <Tabs v-model="selectedTab" class="min-h-0 w-full flex-1 bg-transparent!">
    <TabsList class="gap-x-3 self-center bg-transparent!">
      <TabsTrigger
        v-for="tab in settingsTabs"
        :key="tab.value"
        :value="tab.value"
        class="data-active:bg-primary/10! dark:data-active:bg-primary/20! bg-foreground/5 dark:bg-foreground/10 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize">
        <component :is="tab.icon" />
        {{ "label" in tab ? tab.label : tab.value }}
      </TabsTrigger>
    </TabsList>
    <!-- e.g. the unfinished-setup warning, shown above every tab -->
    <slot />
    <TabsContent
      v-for="tab in settingsTabs"
      :key="tab.value"
      :value="tab.value"
      class="mt-4 min-h-0 flex-1 overflow-y-auto bg-transparent!">
      <component :is="tab.content" />
    </TabsContent>
  </Tabs>
</template>
