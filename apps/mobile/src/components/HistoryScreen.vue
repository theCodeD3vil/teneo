<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import type {
  ClipboardHistoryItem,
  ClipboardListCursor,
} from "@teneo/shared/types/clipboard";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import IconExternalLink from "~icons/tabler/external-link";
import IconPin from "~icons/tabler/pin";
import IconSearch from "~icons/tabler/search";
import IconSettings from "~icons/tabler/settings";
import IconX from "~icons/tabler/x";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useToast } from "../composables/useToast";
import type { MobileSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";
import SyncBadge from "./SyncBadge.vue";

const client = useClient();
const { openSettings, openPairing, openActionSheet } = useNavigation();
const { showToast } = useToast();

const items = ref<ClipboardHistoryItem[]>([]);
const totalCount = ref<number | null>(null);
const nextCursor = ref<ClipboardListCursor | null>(null);
const searchQuery = ref("");
const isLoading = ref(true);
const isLoadingMore = ref(false);

const settings = ref<MobileSettings | null>(null);
const syncStatus = ref<SyncStatus>({ state: "not_paired", devices: [] });

const scrollContainerRef = ref<HTMLElement | null>(null);

// Virtualizer
const rowVirtualizer = useVirtualizer(
  computed(() => ({
    count: items.value.length,
    getScrollElement: () => scrollContainerRef.value,
    estimateSize: () => 92,
    overscan: 6,
  })),
);

// Load settings and sync status
async function loadSettingsAndSync() {
  settings.value = await client.getSettings();
  syncStatus.value = await client.getSyncStatus();
}

// Fetch first page
async function loadItems(query = searchQuery.value) {
  isLoading.value = true;
  try {
    const page = await client.listItems({
      kind: "all",
      search: query,
      limit: 25,
    });
    items.value = page.items;
    totalCount.value = page.total;
    nextCursor.value = page.nextCursor;
  } finally {
    isLoading.value = false;
  }
}

// Fetch next page when scrolling near bottom
async function loadMore() {
  if (isLoadingMore.value || !nextCursor.value) return;
  isLoadingMore.value = true;
  try {
    const page = await client.listItems({
      kind: "all",
      search: searchQuery.value,
      cursor: nextCursor.value,
      limit: 25,
    });
    items.value.push(...page.items);
    nextCursor.value = page.nextCursor;
  } finally {
    isLoadingMore.value = false;
  }
}

// Check infinite scroll position
function handleScroll() {
  const el = scrollContainerRef.value;
  if (!el || !nextCursor.value || isLoadingMore.value) return;
  if (el.scrollHeight - el.scrollTop - el.clientHeight < 300) {
    loadMore();
  }
}

// Search debounce
let searchTimer: ReturnType<typeof setTimeout> | null = null;
watch(searchQuery, (newQuery) => {
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    loadItems(newQuery);
  }, 200);
});

function clearSearch() {
  searchQuery.value = "";
  loadItems("");
}

// Tap: Copy item to clipboard
async function onItemTap(item: ClipboardHistoryItem) {
  await client.copyToClipboard(item.id);
  showToast("Copied to clipboard");
}

// Long-press handling
let pressTimer: ReturnType<typeof setTimeout> | null = null;
let touchStartX = 0;
let touchStartY = 0;
let didLongPress = false;

function onTouchStart(e: TouchEvent, item: ClipboardHistoryItem) {
  didLongPress = false;
  const touch = e.touches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;

  pressTimer = setTimeout(() => {
    didLongPress = true;
    openActionSheet(item);
  }, 450);
}

function onTouchMove(e: TouchEvent) {
  if (!pressTimer) return;
  const touch = e.touches[0];
  const deltaX = Math.abs(touch.clientX - touchStartX);
  const deltaY = Math.abs(touch.clientY - touchStartY);
  if (deltaX > 10 || deltaY > 10) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
}

function onTouchEnd(item: ClipboardHistoryItem) {
  if (pressTimer) {
    clearTimeout(pressTimer);
    pressTimer = null;
  }
  if (!didLongPress) {
    onItemTap(item);
  }
}

function onContextMenu(e: MouseEvent, item: ClipboardHistoryItem) {
  e.preventDefault();
  openActionSheet(item);
}

// Format relative time helper
function formatTime(timestamp: number): string {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour}h ago`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay}d ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Mask secret text preview
function getDisplayText(item: ClipboardHistoryItem): string {
  if (!item.text) return "";
  if (settings.value?.hideSecrets && item.secrets.length > 0) {
    const parts = maskSecrets(item.text, item.secrets);
    return parts.map((p) => p.text).join("");
  }
  return item.text;
}

let unbindHistory: (() => void) | null = null;
let unbindSync: (() => void) | null = null;

onMounted(async () => {
  await loadSettingsAndSync();
  await loadItems();

  unbindHistory = client.onHistoryChanged(async () => {
    // Refresh the list when history changes
    await loadItems();
  });

  unbindSync = client.onSyncStatusChanged((newStatus) => {
    syncStatus.value = newStatus;
  });
});

onUnmounted(() => {
  if (unbindHistory) unbindHistory();
  if (unbindSync) unbindSync();
});
</script>

<template>
  <div class="bg-background flex h-dvh flex-col overflow-hidden">
    <!-- Header with Safe Area Inset Top -->
    <header
      class="safe-area-header border-border bg-background/95 border-b px-4 pt-3 pb-3 backdrop-blur-md">
      <div class="flex items-center justify-between gap-3">
        <div class="flex items-center gap-2.5">
          <span
            class="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-xl shadow-xs"
            aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" class="size-5">
              <rect
                x="6"
                y="5"
                width="12"
                height="15"
                rx="3"
                stroke="currentColor"
                stroke-width="1.8" />
              <path
                d="M9 5.5V4.7A1.7 1.7 0 0 1 10.7 3h2.6A1.7 1.7 0 0 1 15 4.7v.8"
                stroke="currentColor"
                stroke-width="1.8" />
              <path
                d="M9.5 10h5M9.5 13.5h5"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-width="1.8" />
            </svg>
          </span>
          <h1 class="text-lg font-bold tracking-tight">Teneo</h1>
        </div>

        <div class="flex items-center gap-2">
          <SyncBadge
            :status="syncStatus"
            @click="
              syncStatus.state === 'not_paired' ? openPairing() : openSettings()
            " />
          <button
            class="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
            aria-label="Settings"
            @click="openSettings">
            <IconSettings class="size-5" />
          </button>
        </div>
      </div>

      <!-- Search Input -->
      <div class="relative mt-3">
        <span
          class="text-muted-foreground pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
          <IconSearch class="size-4" />
        </span>
        <input
          v-model="searchQuery"
          type="search"
          inputmode="search"
          placeholder="Search history, secrets, links…"
          class="border-input bg-muted/40 text-foreground placeholder:text-muted-foreground focus:border-primary focus:bg-background focus:ring-primary/20 h-11 w-full rounded-2xl border py-2 pr-10 pl-9 text-sm focus:ring-2 focus:outline-hidden" />
        <button
          v-if="searchQuery"
          class="text-muted-foreground hover:text-foreground absolute inset-y-0 right-0 flex size-11 items-center justify-center"
          aria-label="Clear search"
          @click="clearSearch">
          <IconX class="size-4" />
        </button>
      </div>
    </header>

    <!-- Main List View / States -->
    <main
      ref="scrollContainerRef"
      class="flex-1 overflow-y-auto px-4"
      @scroll="handleScroll">
      <!-- Loading Skeleton -->
      <div v-if="isLoading" class="space-y-3 py-4">
        <div
          v-for="i in 6"
          :key="i"
          class="border-border bg-muted/40 h-20 animate-pulse rounded-2xl border" />
      </div>

      <!-- Empty State -->
      <div
        v-else-if="items.length === 0 && !searchQuery"
        class="flex flex-col items-center justify-center py-20 text-center">
        <div
          class="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
          <svg viewBox="0 0 24 24" fill="none" class="size-7">
            <rect
              x="6"
              y="5"
              width="12"
              height="15"
              rx="3"
              stroke="currentColor"
              stroke-width="1.8" />
            <path
              d="M9 5.5V4.7A1.7 1.7 0 0 1 10.7 3h2.6A1.7 1.7 0 0 1 15 4.7v.8"
              stroke="currentColor"
              stroke-width="1.8" />
          </svg>
        </div>
        <h2 class="mt-4 text-base font-semibold">Your clipboard is empty</h2>
        <p class="text-muted-foreground mt-1 max-w-xs text-xs">
          Copied text from this device or paired devices will appear here
          automatically.
        </p>
      </div>

      <!-- No Search Results -->
      <div
        v-else-if="items.length === 0 && searchQuery"
        class="flex flex-col items-center justify-center py-20 text-center">
        <div
          class="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
          <IconSearch class="size-7" />
        </div>
        <h2 class="mt-4 text-base font-semibold">No results found</h2>
        <p class="text-muted-foreground mt-1 max-w-xs text-xs">
          No items match “{{ searchQuery }}”. Try a different keyword or check
          the spelling.
        </p>
        <button
          class="bg-muted hover:bg-muted/80 mt-4 inline-flex min-h-11 items-center rounded-full px-4 text-xs font-semibold"
          @click="clearSearch">
          Clear search
        </button>
      </div>

      <!-- Virtualized Items List -->
      <div
        v-else
        class="py-3"
        :style="{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }">
        <div
          v-for="virtualRow in rowVirtualizer.getVirtualItems()"
          :key="virtualRow.index"
          :style="{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            transform: `translateY(${virtualRow.start}px)`,
          }">
          <div
            v-if="items[virtualRow.index]"
            class="group border-border bg-card hover:border-primary/40 active:bg-muted/50 relative mb-2.5 flex cursor-pointer flex-col justify-between rounded-2xl border p-3.5 shadow-2xs transition-colors select-none"
            role="button"
            tabindex="0"
            @touchstart="onTouchStart($event, items[virtualRow.index])"
            @touchmove="onTouchMove"
            @touchend="onTouchEnd(items[virtualRow.index])"
            @contextmenu="onContextMenu($event, items[virtualRow.index])"
            @click="onItemTap(items[virtualRow.index])">
            <!-- Row text content -->
            <p
              class="text-foreground line-clamp-2 text-sm leading-snug font-normal">
              {{ getDisplayText(items[virtualRow.index]) }}
            </p>

            <!-- Row meta info -->
            <div
              class="text-muted-foreground mt-2.5 flex items-center justify-between text-xs">
              <div class="flex items-center gap-1.5 overflow-hidden">
                <span
                  v-if="items[virtualRow.index].pinned"
                  class="text-primary flex items-center gap-1 font-semibold">
                  <IconPin class="size-3.5 fill-current" />
                  <span>Pinned</span>
                </span>
                <span
                  v-if="items[virtualRow.index].pinned"
                  class="text-muted-foreground/40"
                  >•</span
                >
                <span class="truncate">
                  {{
                    items[virtualRow.index].sourceApp?.name ?? "Unknown device"
                  }}
                </span>
                <span
                  v-if="items[virtualRow.index].link"
                  class="text-muted-foreground flex items-center gap-0.5">
                  <span>•</span>
                  <IconExternalLink class="size-3" />
                  <span class="truncate">{{
                    items[virtualRow.index].link?.host
                  }}</span>
                </span>
              </div>

              <span class="shrink-0 pl-2">
                {{ formatTime(items[virtualRow.index].dateCopied) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- Loading more indicator -->
      <div
        v-if="isLoadingMore"
        class="text-muted-foreground flex justify-center py-3 text-xs">
        Loading more items…
      </div>

      <!-- Bottom padding for safe area gesture pill -->
      <div class="safe-area-bottom-spacer" />
    </main>
  </div>
</template>

<style scoped>
.safe-area-header {
  padding-top: max(
    0.75rem,
    var(--safe-area-inset-top, env(safe-area-inset-top))
  );
}

.safe-area-bottom-spacer {
  height: max(
    1.5rem,
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom))
  );
}
</style>
