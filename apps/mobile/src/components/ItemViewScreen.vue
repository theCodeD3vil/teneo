<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import { computed, onMounted, ref } from "vue";
import IconArrowLeft from "~icons/tabler/arrow-left";
import IconCopy from "~icons/tabler/copy";
import IconExternalLink from "~icons/tabler/external-link";
import IconEye from "~icons/tabler/eye";
import IconEyeOff from "~icons/tabler/eye-off";
import IconPin from "~icons/tabler/pin";
import IconPinnedOff from "~icons/tabler/pinned-off";
import IconShare from "~icons/tabler/share";
import IconTrash from "~icons/tabler/trash";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useToast } from "../composables/useToast";
import type { MobileSettings } from "../types/settings";

const props = defineProps<{
  itemId: string;
}>();

const client = useClient();
const { goBack } = useNavigation();
const { showToast } = useToast();

const item = ref<ClipboardHistoryItem | null>(null);
const settings = ref<MobileSettings | null>(null);
const isLoading = ref(true);
const isSecretRevealed = ref(false);
const showDeleteConfirm = ref(false);

const hasSecrets = computed(() => (item.value?.secrets.length ?? 0) > 0);

const isMasked = computed(() => {
  if (!hasSecrets.value) return false;
  if (!settings.value?.hideSecrets) return false;
  return !isSecretRevealed.value;
});

const renderedParts = computed(() => {
  if (!item.value?.text) return [];
  if (!isMasked.value) {
    return [{ text: item.value.text, isSecret: false, label: "" }];
  }
  const parts = maskSecrets(item.value.text, item.value.secrets);
  return parts.map((p) => ({
    text: p.text,
    isSecret: Boolean(p.secretLabel),
    label: p.secretLabel ?? "",
  }));
});

const wordCount = computed(() => {
  if (!item.value?.text) return 0;
  return item.value.text.trim().split(/\s+/).filter(Boolean).length;
});

const formattedDateTime = computed(() => {
  if (!item.value) return "";
  return new Date(item.value.dateCopied).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  });
});

async function loadItem() {
  isLoading.value = true;
  try {
    settings.value = await client.getSettings();
    item.value = await client.getItem(props.itemId);
  } finally {
    isLoading.value = false;
  }
}

async function handleCopy() {
  if (!item.value) return;
  await client.copyToClipboard(item.value.id);
  showToast("Copied to clipboard");
}

async function handleTogglePin() {
  if (!item.value) return;
  const nextPinned = !item.value.pinned;
  await client.setPinned(item.value.id, nextPinned);
  item.value.pinned = nextPinned;
  showToast(nextPinned ? "Item pinned" : "Item unpinned");
}

async function handleShare() {
  if (!item.value?.text) return;
  if (navigator.share) {
    try {
      await navigator.share({
        text: item.value.text,
      });
    } catch {
      // User cancelled share
    }
  } else {
    await handleCopy();
  }
}

async function handleDelete() {
  if (!item.value) return;
  await client.deleteItem(item.value.id);
  showToast("Item deleted");
  goBack();
}

function openExternalLink() {
  if (item.value?.link?.url) {
    window.open(item.value.link.url, "_blank");
  }
}

onMounted(() => {
  loadItem();
});
</script>

<template>
  <div class="bg-background flex h-dvh flex-col overflow-hidden">
    <!-- Header -->
    <header
      class="safe-area-header border-border bg-background/95 border-b px-4 pt-3 pb-3 backdrop-blur-md">
      <div class="flex items-center justify-between">
        <div class="flex items-center gap-1.5">
          <button
            class="text-foreground hover:bg-muted active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
            aria-label="Go back"
            @click="goBack">
            <IconArrowLeft class="size-5" />
          </button>
          <span class="text-base font-semibold tracking-tight"
            >Item details</span
          >
        </div>

        <div v-if="item" class="flex items-center gap-1">
          <button
            class="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
            :title="item.pinned ? 'Unpin' : 'Pin'"
            :aria-label="item.pinned ? 'Unpin item' : 'Pin item'"
            @click="handleTogglePin">
            <component
              :is="item.pinned ? IconPinnedOff : IconPin"
              class="size-5"
              :class="item.pinned ? 'text-primary fill-current' : ''" />
          </button>

          <button
            class="text-muted-foreground hover:bg-muted hover:text-foreground active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
            aria-label="Share"
            @click="handleShare">
            <IconShare class="size-5" />
          </button>
        </div>
      </div>
    </header>

    <!-- Main Content Area -->
    <main v-if="isLoading" class="flex-1 p-5">
      <div class="bg-muted/40 h-64 animate-pulse rounded-2xl" />
    </main>

    <main v-else-if="item" class="flex-1 overflow-y-auto p-4">
      <!-- Secrets Banner (if secrets detected) -->
      <div
        v-if="hasSecrets"
        class="mb-4 flex items-center justify-between rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3.5 text-xs text-amber-700 dark:text-amber-300">
        <div class="flex items-center gap-2">
          <span class="font-semibold">Contains sensitive data:</span>
          <span class="rounded-md bg-amber-500/20 px-2 py-0.5 font-mono">
            {{ item.secrets[0]?.label ?? "Secret detected" }}
          </span>
        </div>
        <button
          class="flex min-h-9 items-center gap-1.5 rounded-full bg-amber-500/20 px-3 py-1 font-semibold hover:bg-amber-500/30"
          @click="isSecretRevealed = !isSecretRevealed">
          <component
            :is="isSecretRevealed ? IconEyeOff : IconEye"
            class="size-3.5" />
          <span>{{ isSecretRevealed ? "Hide" : "Reveal" }}</span>
        </button>
      </div>

      <!-- Text Container (Selectable) -->
      <div
        class="border-border bg-card text-foreground rounded-2xl border p-4 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap shadow-2xs select-text">
        <template v-for="(part, index) in renderedParts" :key="index">
          <span
            v-if="part.isSecret"
            class="rounded-sm bg-amber-500/20 px-1 py-0.5 font-bold tracking-wider text-amber-800 select-none dark:text-amber-200">
            {{ part.text }}
          </span>
          <span v-else>{{ part.text }}</span>
        </template>
      </div>

      <!-- Link Action if item has link -->
      <div v-if="item.link" class="mt-4">
        <button
          class="border-border bg-muted/40 hover:bg-muted/70 active:bg-muted flex min-h-12 w-full items-center justify-between rounded-2xl border px-4 py-3 text-left"
          @click="openExternalLink">
          <div class="min-w-0 flex-1 pr-3">
            <p class="text-muted-foreground text-xs">Source URL</p>
            <p class="text-primary truncate text-sm font-medium">
              {{ item.link.url }}
            </p>
          </div>
          <IconExternalLink class="text-muted-foreground size-5 shrink-0" />
        </button>
      </div>

      <!-- Item Metadata Details -->
      <div
        class="border-border/80 bg-muted/20 text-muted-foreground mt-5 space-y-2.5 rounded-2xl border p-4 text-xs">
        <div class="flex justify-between py-1">
          <span>Copied</span>
          <span class="text-foreground font-medium">{{
            formattedDateTime
          }}</span>
        </div>
        <div class="border-border/40 border-t" />
        <div class="flex justify-between py-1">
          <span>Origin device</span>
          <span class="text-foreground font-medium">
            {{ item.sourceApp?.name ?? "Pixel 6 Pro" }}
          </span>
        </div>
        <div class="border-border/40 border-t" />
        <div class="flex justify-between py-1">
          <span>Length</span>
          <span class="text-foreground font-medium">
            {{ item.text?.length ?? 0 }} chars • {{ wordCount }} words
          </span>
        </div>
        <div v-if="item.pinned" class="border-border/40 border-t" />
        <div v-if="item.pinned" class="flex justify-between py-1">
          <span>Status</span>
          <span class="text-primary font-medium">Pinned</span>
        </div>
      </div>

      <div class="safe-area-bottom-spacer" />
    </main>

    <!-- Bottom Action Bar (Fixed, Safe Area) -->
    <footer
      v-if="item"
      class="safe-area-footer border-border bg-background/95 border-t px-4 py-3 backdrop-blur-md">
      <div class="flex items-center gap-2.5">
        <button
          class="bg-primary text-primary-foreground active:bg-primary/90 flex h-12 flex-1 items-center justify-center gap-2 rounded-2xl text-sm font-semibold shadow-xs"
          @click="handleCopy">
          <IconCopy class="size-4" />
          <span>Copy to clipboard</span>
        </button>

        <button
          class="border-border bg-card text-muted-foreground hover:text-foreground active:bg-muted flex size-12 items-center justify-center rounded-2xl border"
          aria-label="Share"
          @click="handleShare">
          <IconShare class="size-5" />
        </button>

        <button
          class="border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 active:bg-destructive/30 flex size-12 items-center justify-center rounded-2xl border"
          aria-label="Delete item"
          @click="showDeleteConfirm = true">
          <IconTrash class="size-5" />
        </button>
      </div>
    </footer>

    <!-- Delete Confirmation Modal -->
    <Teleport to="body">
      <div
        v-if="showDeleteConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5 backdrop-blur-xs"
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm delete">
        <div
          class="border-border bg-background w-full max-w-sm rounded-3xl border p-6 shadow-2xl">
          <h3 class="text-foreground text-base font-bold">Delete this item?</h3>
          <p class="text-muted-foreground mt-2 text-xs leading-relaxed">
            This will permanently remove the item from your clipboard history
            across synced devices.
          </p>
          <div class="mt-6 flex justify-end gap-3">
            <button
              class="text-muted-foreground hover:bg-muted active:bg-muted/80 h-11 rounded-xl px-4 text-xs font-semibold"
              @click="showDeleteConfirm = false">
              Cancel
            </button>
            <button
              class="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 h-11 rounded-xl px-4 text-xs font-semibold"
              @click="handleDelete">
              Delete
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.safe-area-header {
  padding-top: max(
    0.75rem,
    var(--safe-area-inset-top, env(safe-area-inset-top))
  );
}

.safe-area-footer {
  padding-bottom: max(
    1rem,
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom))
  );
}

.safe-area-bottom-spacer {
  height: max(
    4rem,
    calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 3rem)
  );
}
</style>
