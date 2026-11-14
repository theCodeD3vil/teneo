<script setup lang="ts">
import { ref } from "vue";
import HardDriveIcon from "~icons/tabler/database";
import InformationCircleIcon from "~icons/tabler/info-circle";
import KeyboardIcon from "~icons/tabler/keyboard";
import SettingsIcon from "~icons/tabler/settings";
import ShieldIcon from "~icons/tabler/shield";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import AboutTab from "./AboutTab.vue";
import GeneralTab from "./GeneralTab.vue";
import HotkeysTab from "./HotkeysTab.vue";
import SecurityTab from "./SecurityTab.vue";
import StorageTab from "./StorageTab.vue";

const settingsTabs = [
  { value: "general", icon: SettingsIcon, content: GeneralTab },
  { value: "security", icon: ShieldIcon, content: SecurityTab },
  { value: "hotkeys", icon: KeyboardIcon, content: HotkeysTab },
  { value: "storage", icon: HardDriveIcon, content: StorageTab },
  { value: "about", icon: InformationCircleIcon, content: AboutTab },
] as const;

type SettingsTab = (typeof settingsTabs)[number]["value"];

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
        {{ tab.value }}
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
