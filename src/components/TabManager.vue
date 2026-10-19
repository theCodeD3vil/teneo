<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from "vue";
import ArrowLeftIcon from "~icons/hugeicons/arrow-left-01";
import ArrowRightIcon from "~icons/hugeicons/arrow-right-01";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipboard } from "@/composables/useClipboard";
import { useHotkeys } from "@/composables/useHotkeys";
import { useSettings } from "@/composables/useSettings";
import { omit } from "@/utils/helpers";

import {
  clipboardItemVariants,
  type ClipboardHistoryItem,
  type TabVariant,
} from "../types/clipboard";
import AllTabContent from "./AllTabContent.vue";
import Kbd from "./ui/kbd/Kbd.vue";

const props = defineProps<{
  searchQuery: string;
}>();

const emit = defineEmits<{
  (e: "tab-change", count: number): void;
}>();

const tabValues: TabVariant[] = omit(clipboardItemVariants, "empty");
const defaultTab = tabValues[0];
const selectedTab = ref<TabVariant>(defaultTab);
const activeItemId = ref<string | null>(null);
const allTabContent = ref<InstanceType<typeof AllTabContent> | null>(null);
const debouncedSearchQuery = ref("");
const { clipboardItems, error, loading } = useClipboard();
const { settings } = useSettings();
let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

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

const selectedItems = computed(() => getItemsForTab(selectedTab.value));

function getItemsForTab(tab: TabVariant): ClipboardHistoryItem[] {
  const items = itemsByTab.value[tab];
  const searchQuery = debouncedSearchQuery.value;

  return searchQuery
    ? items.filter((item) => matchesSearchQuery(item, searchQuery))
    : items;
}

function matchesSearchQuery(
  item: ClipboardHistoryItem,
  searchQuery: string,
): boolean {
  return [
    item.text,
    item.html,
    item.color,
    item.paths.join(" "),
    item.sourceApp?.name,
    item.sourceURL,
  ].some((value) => value?.toLowerCase().includes(searchQuery));
}

function activateFirstItem(): void {
  selectedTab.value = defaultTab;
  activeItemId.value = getItemsForTab(defaultTab)[0]?.id ?? null;
}

function moveActiveTab(direction: -1 | 1): boolean {
  const nextTabIndex = tabValues.indexOf(selectedTab.value) + direction;
  const nextTab = tabValues[nextTabIndex];
  if (!nextTab) return false;

  selectedTab.value = nextTab;
  activeItemId.value = getItemsForTab(nextTab)[0]?.id ?? null;
  return true;
}

function moveActiveItem(direction: -1 | 1): boolean {
  const items = selectedItems.value;
  if (!items.length) return false;

  const currentItemIndex = items.findIndex(
    (item) => item.id === activeItemId.value,
  );
  const nextItemIndex = Math.min(
    Math.max(currentItemIndex + direction, 0),
    items.length - 1,
  );
  const nextItem = items[nextItemIndex] ?? items[0];

  activeItemId.value = nextItem.id;
  return true;
}

function copyActiveItem(): boolean {
  if (settings.value.pasteOnEnter) return pasteActiveItem();
  return allTabContent.value?.copyActiveItem(activeItemId.value) ?? false;
}

function pasteActiveItem(): boolean {
  return allTabContent.value?.pasteActiveItem(activeItemId.value) ?? false;
}

function previewActiveItem(): boolean {
  return allTabContent.value?.previewActiveItem(activeItemId.value) ?? false;
}

function deleteActiveItem(): boolean {
  const items = selectedItems.value;
  const index = items.findIndex((item) => item.id === activeItemId.value);
  if (!allTabContent.value?.deleteActiveItem(activeItemId.value)) return false;

  // Select the next item (or the previous, when deleting the last) so D can be pressed again
  activeItemId.value = (items[index + 1] ?? items[index - 1])?.id ?? null;
  return true;
}

function pinActiveItem(): boolean {
  return allTabContent.value?.pinActiveItem(activeItemId.value) ?? false;
}

useHotkeys({
  moveActiveTab,
  moveActiveItem,
  copyActiveItem,
  pasteSelectedItem: pasteActiveItem,
  previewSelectedItem: previewActiveItem,
  deleteSelectedItem: deleteActiveItem,
  pinSelectedItem: pinActiveItem,
});

watch(
  () => props.searchQuery,
  (searchQuery) => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      debouncedSearchQuery.value = searchQuery.trim().toLowerCase();
    }, 200);
  },
  { immediate: true },
);

watch(selectedTab, () => {
  activeItemId.value = selectedItems.value[0]?.id ?? null;
});

watch(
  selectedItems,
  (items) => {
    emit("tab-change", items.length);

    if (!items.some((item) => item.id === activeItemId.value)) {
      activeItemId.value = items[0]?.id ?? null;
    }
  },
  {
    immediate: true,
  },
);

defineExpose({ activateFirstItem });

onUnmounted(() => clearTimeout(searchDebounceTimeout));
</script>

<template>
  <Tabs v-model="selectedTab" class="min-h-0 w-full flex-1 bg-transparent!">
    <TabsList class="sticky top-0 w-full justify-start gap-x-3 bg-transparent!">
      <div v-for="tabItem in tabValues" :key="tabItem">
        <TabsTrigger
          class="data-active:bg-primary/10! bg-foreground/5 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
      <div class="text-foreground/60 ml-auto flex items-center gap-1 text-xs">
        <Kbd class="bg-foreground/10"> <ArrowLeftIcon /> </Kbd>
        <Kbd class="bg-foreground/10"> <ArrowRightIcon /> </Kbd>
        tabs
      </div>
    </TabsList>
    <TabsContent
      :value="selectedTab"
      force-mount
      class="mt-3 min-h-0 flex-1 bg-transparent!">
      <AllTabContent
        ref="allTabContent"
        :items="selectedItems"
        :tab="selectedTab"
        :active-item-id="activeItemId"
        :loading="loading"
        :error="error"
        :empty-message="emptyMessages[selectedTab]" />
    </TabsContent>
  </Tabs>
</template>
