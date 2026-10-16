<script setup lang="ts">
import { computed } from "vue";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipboard } from "@/composables/useClipboard";
import { omit } from "@/utils/helpers";

import {
  clipboardItemVariants,
  type ClipboardHistoryItem,
  type TabVariant,
} from "../types/clipboard";
import AllTabContent from "./AllTabContent.vue";

const tabValues: TabVariant[] = omit(clipboardItemVariants, "empty");
const defaultTab = tabValues[0];
const { clipboardItems, error, loading } = useClipboard();

const itemsByTab = computed<Record<TabVariant, ClipboardHistoryItem[]>>(() => ({
  all: clipboardItems.value,
  files: clipboardItems.value.filter((item) => item.kind === "files"),
  image: clipboardItems.value.filter((item) => item.kind === "image"),
  color: clipboardItems.value.filter((item) => item.kind === "color"),
  text: clipboardItems.value.filter((item) => item.kind === "text"),
}));

const emptyMessages: Record<TabVariant, string> = {
  all: "No clipboard history yet.",
  files: "No copied files yet.",
  image: "No copied images yet.",
  color: "No copied colors yet.",
  text: "No copied text yet.",
};
</script>

<template>
  <Tabs
    class="min-h-0 w-full flex-1 bg-transparent!"
    :default-value="defaultTab">
    <TabsList class="sticky top-0 w-full justify-start gap-x-3 bg-transparent!">
      <div v-for="tabItem in tabValues" :key="tabItem">
        <TabsTrigger
          class="data-active:bg-primary/10! bg-foreground/5 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
    </TabsList>
    <TabsContent
      v-for="tabItem in tabValues"
      :key="tabItem"
      :value="tabItem"
      class="mt-3 min-h-0 flex-1 bg-transparent!">
      <AllTabContent
        :items="itemsByTab[tabItem]"
        :loading="loading"
        :error="error"
        :empty-message="emptyMessages[tabItem]" />
    </TabsContent>
  </Tabs>
</template>
