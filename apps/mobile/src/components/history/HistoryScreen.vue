<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { ref } from "vue";

import { useNavigation } from "../../composables/useNavigation";
import HomeFooter from "./HomeFooter.vue";
import SearchInput from "./SearchInput.vue";
import TabManager from "./TabManager.vue";

const { openItemView } = useNavigation();
const searchInput = ref<InstanceType<typeof SearchInput> | null>(null);
const searchQuery = ref("");
const clipboardItemsCount = ref(0);

function openPreview(item: ClipboardHistoryItem): void {
  searchInput.value?.blur();
  openItemView(item.id);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <SearchInput ref="searchInput" v-model="searchQuery" />
    <TabManager
      :search-query="searchQuery"
      @tab-change="(count: number) => (clipboardItemsCount = count)"
      @preview="openPreview" />
    <HomeFooter :clipboard-items-count="clipboardItemsCount" />
  </div>
</template>
