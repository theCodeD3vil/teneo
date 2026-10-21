<script setup lang="ts">
import {
  computed,
  onBeforeMount,
  onMounted,
  onUnmounted,
  ref,
  watch,
} from "vue";
import ArrowLeftIcon from "~icons/tabler/chevron-left";
import ArrowRightIcon from "~icons/tabler/chevron-right";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useClipboard } from "@/composables/useClipboard";
import { useHotkeys } from "@/composables/useHotkeys";
import { useSettings } from "@/composables/useSettings";
import { omit } from "@/utils/helpers";
import { maskSecrets } from "@/utils/secrets";

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
const debouncedSearchQuery = ref(normalizeSearchQuery(props.searchQuery));
const { clipboardItems, error, loading } = useClipboard();
const { settings } = useSettings();
let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

// App.vue mounts a new TabManager for every visit to the panel, and it always
// opens on All: the tab is never remembered between visits
function showAllTab(): void {
  selectedTab.value = defaultTab;
}
onBeforeMount(showAllTab);
onMounted(showAllTab);

function normalizeSearchQuery(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

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
    searchableText(item),
    item.html,
    item.color,
    item.paths.join(" "),
    item.sourceApp?.name,
    item.sourceURL,
  ].some((value) => value?.toLowerCase().includes(searchQuery));
}

// A masked key is found by what the card shows and by its kind ("GitHub
// token"), so searching for part of it can't reveal which item holds it
function searchableText(item: ClipboardHistoryItem): string | null {
  if (!item.text || !settings.value.maskSecrets || !item.secrets.length) {
    return item.text;
  }
  return maskSecrets(item.text, item.secrets)
    .map((part) =>
      part.secretLabel ? `${part.text} ${part.secretLabel} ` : part.text,
    )
    .join("");
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
    emit("tab-change", items.length);

    if (!items.some((item) => item.id === activeItemId.value)) {
      activeItemId.value = items[0]?.id ?? null;
    }
  },
  {
    immediate: true,
  },
);

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
