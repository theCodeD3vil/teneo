<script setup lang="ts">
import { onBeforeMount, onMounted, onUnmounted, ref, watch } from "vue";
import ArrowLeftIcon from "~icons/tabler/chevron-left";
import ArrowRightIcon from "~icons/tabler/chevron-right";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipboardList } from "@/composables/useClipboard";
import { useHotkeys } from "@/composables/useHotkeys";
import { useSettings } from "@/composables/useSettings";
import type { QuickCopyItemNumber } from "@/constants/hotkeys";
import { omit } from "@/utils/helpers";
import { resetPanelEvent } from "@/utils/panel-reset";

import {
  clipboardItemVariants,
  type ClipboardHistoryItem,
  type TabVariant,
} from "../types/clipboard";
import AllTabContent from "./AllTabContent.vue";
import Kbd from "./ui/kbd/Kbd.vue";

const props = defineProps<{
  searchQuery: string;
  previewOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "tab-change", count: number): void;
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const tabValues: TabVariant[] = omit(clipboardItemVariants, "empty");
const defaultTab = tabValues[0];
const selectedTab = ref<TabVariant>(defaultTab);
const activeItemId = ref<string | null>(null);
const allTabContent = ref<InstanceType<typeof AllTabContent> | null>(null);
const debouncedSearchQuery = ref(normalizeSearchQuery(props.searchQuery));
// The backend filters by tab and search and returns a page at a time, so the
// page never holds the whole history (see useClipboardList)
const {
  items: selectedItems,
  total,
  error,
  loading,
  hasMore,
  loadingMore,
  loadMore,
} = useClipboardList(() => ({
  kind: selectedTab.value,
  search: debouncedSearchQuery.value,
}));
const { settings } = useSettings();
let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

// The panel always opens on All, on its first item: neither the tab nor the
// item is remembered between visits. It's reset as the panel hides, and again
// before it shows (see utils/panel-reset).
// (the selectedItems watch below picks the first item once its list is in)
function showAllTab(): void {
  selectedTab.value = defaultTab;
  activeItemId.value = selectedItems.value[0]?.id ?? null;
}
onBeforeMount(showAllTab);
onMounted(() => {
  showAllTab();
  window.addEventListener(resetPanelEvent, showAllTab);
});

function normalizeSearchQuery(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

const emptyMessages: Record<TabVariant, string> = {
  all: "No clipboard history yet.",
  files: "No copied files yet.",
  image: "No copied images yet.",
  color: "No copied colors yet.",
  text: "No copied text yet.",
};

function moveActiveTab(direction: -1 | 1): boolean {
  const nextTabIndex = tabValues.indexOf(selectedTab.value) + direction;
  const nextTab = tabValues[nextTabIndex];
  if (!nextTab) return false;

  selectedTab.value = nextTab;
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
  const item = selectedItems.value.find(({ id }) => id === activeItemId.value);
  if (!item) return false;

  previewItem(item);
  return true;
}

// A double-clicked card becomes the selection, so back lands on it
function previewItem(item: ClipboardHistoryItem): void {
  activeItemId.value = item.id;
  emit("preview", item);
}

// D and P take the selected card away from where the user is, so selection
// stays in place on its neighbour and they can carry on down the list
function deleteActiveItem(): boolean {
  const neighbourId = getActiveItemNeighbourId();
  if (!allTabContent.value?.deleteActiveItem(activeItemId.value)) return false;

  activeItemId.value = neighbourId;
  return true;
}

function pinActiveItem(): boolean {
  const neighbourId = getActiveItemNeighbourId();
  if (!allTabContent.value?.pinActiveItem(activeItemId.value)) return false;

  activeItemId.value = neighbourId ?? activeItemId.value; // a lone item stays selected
  return true;
}

// The item after the selected one, or before it when it's the last
function getActiveItemNeighbourId(): string | null {
  const items = selectedItems.value;
  const index = items.findIndex((item) => item.id === activeItemId.value);
  return (items[index + 1] ?? items[index - 1])?.id ?? null;
}

// ⌘1-9 copy the item at that place in the tab, whether or not its card is on screen
function copyItemByNumber(itemNumber: QuickCopyItemNumber): boolean {
  return allTabContent.value?.copyItemByNumber(itemNumber) ?? false;
}

// The list stays mounted under the preview, so its keys must not act on it
useHotkeys(
  {
    moveActiveTab,
    moveActiveItem,
    copyActiveItem,
    copyItemByNumber,
    pasteSelectedItem: pasteActiveItem,
    previewSelectedItem: previewActiveItem,
    deleteSelectedItem: deleteActiveItem,
    pinSelectedItem: pinActiveItem,
  },
  () => !props.previewOpen,
);

watch(
  () => props.searchQuery,
  (searchQuery) => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      debouncedSearchQuery.value = normalizeSearchQuery(searchQuery);
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
    if (!items.some((item) => item.id === activeItemId.value)) {
      activeItemId.value = items[0]?.id ?? null;
    }
  },
  {
    immediate: true,
  },
);

// how many the tab holds in all, not only the pages loaded so far
watch(total, (count) => emit("tab-change", count), { immediate: true });

onUnmounted(() => {
  clearTimeout(searchDebounceTimeout);
  window.removeEventListener(resetPanelEvent, showAllTab);
});
</script>

<template>
  <Tabs v-model="selectedTab" class="min-h-0 w-full flex-1 bg-transparent!">
    <TabsList class="sticky top-0 w-full justify-start gap-x-3 bg-transparent!">
      <div v-for="tabItem in tabValues" :key="tabItem">
        <TabsTrigger
          class="data-active:bg-primary/10! dark:data-active:bg-primary/20! bg-foreground/5 dark:bg-foreground/10 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
      <div class="text-foreground/60 ml-auto flex items-center gap-1 text-xs">
        <Kbd class="bg-foreground/10 dark:bg-foreground/15">
          <ArrowLeftIcon />
        </Kbd>
        <Kbd class="bg-foreground/10 dark:bg-foreground/15">
          <ArrowRightIcon />
        </Kbd>
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
        :has-more="hasMore"
        :loading-more="loadingMore"
        :empty-message="emptyMessages[selectedTab]"
        @preview="previewItem"
        @load-more="loadMore" />
    </TabsContent>
  </Tabs>
</template>
