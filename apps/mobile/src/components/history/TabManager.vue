<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@teneo/ui/components/tabs";
import { onUnmounted, ref, watch } from "vue";

import { useClipboardList } from "../../composables/useClipboard";
import { emptyMessages, tabValues, type TabVariant } from "../../types/tabs";
import AllTabContent from "./AllTabContent.vue";

const props = defineProps<{
  searchQuery: string;
}>();

const emit = defineEmits<{
  (e: "tab-change", count: number): void;
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const selectedTab = ref<TabVariant>("all");
const debouncedSearchQuery = ref(normalizeSearchQuery(props.searchQuery));
const { items, total, error, loading, hasMore, loadingMore, loadMore } =
  useClipboardList(() => ({
    kind: selectedTab.value,
    search: debouncedSearchQuery.value,
  }));
let searchDebounceTimeout: ReturnType<typeof setTimeout> | undefined;

function normalizeSearchQuery(searchQuery: string): string {
  return searchQuery.trim().toLowerCase();
}

watch(
  () => props.searchQuery,
  (searchQuery) => {
    clearTimeout(searchDebounceTimeout);
    searchDebounceTimeout = setTimeout(() => {
      debouncedSearchQuery.value = normalizeSearchQuery(searchQuery);
    }, 200);
  },
);

// how many the tab holds in all, not only the pages loaded so far
watch(total, (count) => emit("tab-change", count), { immediate: true });

onUnmounted(() => clearTimeout(searchDebounceTimeout));
</script>

<template>
  <Tabs
    v-model="selectedTab"
    class="flex min-h-0 w-full flex-1 flex-col bg-transparent!">
    <!-- scrolls sideways if a narrow phone can't fit every tab -->
    <TabsList
      class="h-auto! w-full shrink-0 [scrollbar-width:none] justify-start gap-x-2 overflow-x-auto bg-transparent! p-0!">
      <div v-for="tabItem in tabValues" :key="tabItem" class="shrink-0">
        <TabsTrigger
          class="data-active:bg-primary/10! dark:data-active:bg-primary/20! bg-foreground/5 dark:bg-foreground/10 data-active:text-primary! data-active:border-primary/80! h-9 rounded-full px-3.5 text-sm font-normal capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
    </TabsList>
    <TabsContent
      :value="selectedTab"
      force-mount
      class="mt-3 min-h-0 flex-1 bg-transparent!">
      <AllTabContent
        :items="items"
        :tab="selectedTab"
        :loading="loading"
        :error="error"
        :has-more="hasMore"
        :loading-more="loadingMore"
        :empty-message="emptyMessages[selectedTab]"
        @preview="emit('preview', $event)"
        @load-more="loadMore" />
    </TabsContent>
  </Tabs>
</template>
