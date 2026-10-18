<script setup lang="ts">
import { ref } from "vue";
import HardDriveIcon from "~icons/hugeicons/hard-drive";
import InformationCircleIcon from "~icons/hugeicons/information-circle";
import KeyboardIcon from "~icons/hugeicons/keyboard";
import SettingsIcon from "~icons/hugeicons/settings-02";
import ShieldIcon from "~icons/hugeicons/shield-01";

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
        class="data-active:bg-primary/10! bg-foreground/5 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize">
        <component :is="tab.icon" />
        {{ tab.value }}
      </TabsTrigger>
    </TabsList>
    <TabsContent
      v-for="tab in settingsTabs"
      :key="tab.value"
      :value="tab.value"
      class="mt-4 min-h-0 flex-1 overflow-y-auto bg-transparent!">
      <component :is="tab.content" />
    </TabsContent>
  </Tabs>
</template>
