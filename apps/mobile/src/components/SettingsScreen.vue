<script setup lang="ts">
import { onMounted, onUnmounted, ref } from "vue";
import IconArrowLeft from "~icons/tabler/arrow-left";
import IconDeviceDesktop from "~icons/tabler/device-desktop";
import IconExternalLink from "~icons/tabler/external-link";
import IconQrcode from "~icons/tabler/qrcode";
import IconTrash from "~icons/tabler/trash";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useToast } from "../composables/useToast";
import type { MobileSettings } from "../types/settings";
import type { SyncStatus } from "../types/sync";

const client = useClient();
const { goBack, openPairing } = useNavigation();
const { showToast } = useToast();

const settings = ref<MobileSettings | null>(null);
const syncStatus = ref<SyncStatus>({ state: "not_paired", devices: [] });
const isLoading = ref(true);
const showUnpairConfirm = ref(false);

const retentionOptions = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
  { label: "Forever", value: 0 },
];

const maxItemsOptions = [
  { label: "100", value: 100 },
  { label: "500", value: 500 },
  { label: "1,000", value: 1000 },
  { label: "5,000", value: 5000 },
];

async function loadSettings() {
  isLoading.value = true;
  try {
    settings.value = await client.getSettings();
    syncStatus.value = await client.getSyncStatus();
  } finally {
    isLoading.value = false;
  }
}

async function updateSetting<K extends keyof MobileSettings>(
  key: K,
  value: MobileSettings[K],
) {
  if (!settings.value) return;
  settings.value[key] = value;
  await client.updateSettings({ [key]: value });
}

async function handleUnpair() {
  await client.unpair();
  showUnpairConfirm.value = false;
  showToast("Device unpaired");
}

let unbindSync: (() => void) | null = null;

onMounted(async () => {
  await loadSettings();
  unbindSync = client.onSyncStatusChanged((newStatus) => {
    syncStatus.value = newStatus;
  });
});

onUnmounted(() => {
  if (unbindSync) unbindSync();
});
</script>

<template>
  <div class="bg-background flex h-dvh flex-col overflow-hidden">
    <!-- Header -->
    <header
      class="safe-area-header border-border bg-background/95 border-b px-4 pt-3 pb-3 backdrop-blur-md">
      <div class="flex items-center gap-1.5">
        <button
          class="text-foreground hover:bg-muted active:bg-muted/80 flex size-11 items-center justify-center rounded-full"
          aria-label="Go back"
          @click="goBack">
          <IconArrowLeft class="size-5" />
        </button>
        <h1 class="text-base font-semibold tracking-tight">Settings</h1>
      </div>
    </header>

    <!-- Main Content -->
    <main v-if="isLoading" class="flex-1 p-5">
      <div class="space-y-4">
        <div class="bg-muted/40 h-32 animate-pulse rounded-2xl" />
        <div class="bg-muted/40 h-48 animate-pulse rounded-2xl" />
      </div>
    </main>

    <main
      v-else-if="settings"
      class="flex-1 space-y-6 overflow-y-auto px-4 py-5">
      <!-- Sync Section -->
      <section aria-labelledby="sync-heading" class="space-y-3">
        <h2
          id="sync-heading"
          class="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
          Sync & Devices
        </h2>

        <!-- Connected Device Card -->
        <div
          v-if="syncStatus.state === 'connected'"
          class="border-border bg-card rounded-2xl border p-4 shadow-2xs">
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <span
                class="bg-primary/10 text-primary flex size-10 items-center justify-center rounded-xl">
                <IconDeviceDesktop class="size-5" />
              </span>
              <div>
                <p class="text-foreground text-sm font-semibold">
                  {{ syncStatus.devices[0]?.name ?? "MacBook Pro" }}
                </p>
                <p class="text-muted-foreground text-xs">
                  {{ syncStatus.devices[0]?.model ?? "Apple Silicon Mac" }} •
                  Connected
                </p>
              </div>
            </div>
            <span class="mt-1 flex size-2 rounded-full bg-emerald-500" />
          </div>

          <div class="border-border/60 mt-4 border-t pt-3">
            <button
              class="text-destructive hover:bg-destructive/10 active:bg-destructive/20 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-semibold"
              @click="showUnpairConfirm = true">
              <IconTrash class="size-3.5" />
              <span>Unpair Mac</span>
            </button>
          </div>
        </div>

        <!-- Not Paired State -->
        <div
          v-else
          class="border-border bg-muted/20 flex flex-col items-center justify-between gap-3 rounded-2xl border border-dashed p-5 text-center">
          <div class="text-muted-foreground text-xs">
            No Mac paired yet. Connect to sync your clipboard automatically.
          </div>
          <button
            class="bg-primary text-primary-foreground active:bg-primary/90 flex min-h-12 items-center gap-2 rounded-xl px-5 text-xs font-semibold shadow-xs"
            @click="openPairing('scan')">
            <IconQrcode class="size-4" />
            <span>Pair with Mac</span>
          </button>
        </div>

        <!-- Sync Toggles -->
        <div
          class="border-border bg-card space-y-4 rounded-2xl border p-4 shadow-2xs">
          <label class="flex cursor-pointer items-center justify-between">
            <div>
              <p class="text-foreground text-sm font-medium">
                Receive in background
              </p>
              <p class="text-muted-foreground text-xs">
                Keep listening for copies from Mac
              </p>
            </div>
            <input
              type="checkbox"
              :checked="settings.backgroundReceive"
              class="accent-primary size-5 cursor-pointer rounded"
              @change="
                updateSetting(
                  'backgroundReceive',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
          </label>

          <div class="border-border/40 border-t" />

          <label class="flex cursor-pointer items-center justify-between">
            <div>
              <p class="text-foreground text-sm font-medium">Sync secrets</p>
              <p class="text-muted-foreground text-xs">
                Include tokens and credentials in sync
              </p>
            </div>
            <input
              type="checkbox"
              :checked="settings.syncSecrets"
              class="accent-primary size-5 cursor-pointer rounded"
              @change="
                updateSetting(
                  'syncSecrets',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
          </label>
        </div>
      </section>

      <!-- Capture Section -->
      <section aria-labelledby="capture-heading" class="space-y-3">
        <h2
          id="capture-heading"
          class="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
          Capture
        </h2>
        <div class="border-border bg-card rounded-2xl border p-4 shadow-2xs">
          <label class="flex cursor-pointer items-center justify-between">
            <div class="pr-3">
              <p class="text-foreground text-sm font-medium">Save on open</p>
              <p class="text-muted-foreground text-xs">
                Save what's on the Android clipboard whenever Teneo is opened
              </p>
            </div>
            <input
              type="checkbox"
              :checked="settings.captureOnOpen"
              class="accent-primary size-5 shrink-0 cursor-pointer rounded"
              @change="
                updateSetting(
                  'captureOnOpen',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
          </label>
        </div>
      </section>

      <!-- History Section -->
      <section aria-labelledby="history-heading" class="space-y-3">
        <h2
          id="history-heading"
          class="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
          History
        </h2>
        <div
          class="border-border bg-card space-y-4 rounded-2xl border p-4 shadow-2xs">
          <div>
            <p class="text-foreground mb-2 text-sm font-medium">
              Keep history for
            </p>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="opt in retentionOptions"
                :key="opt.value"
                type="button"
                class="flex min-h-10 items-center justify-center rounded-xl border text-xs font-medium transition-colors"
                :class="
                  settings.historyRetentionDays === opt.value
                    ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                "
                @click="updateSetting('historyRetentionDays', opt.value)">
                {{ opt.label }}
              </button>
            </div>
          </div>

          <div class="border-border/40 border-t" />

          <div>
            <p class="text-foreground mb-2 text-sm font-medium">
              Maximum items
            </p>
            <div class="grid grid-cols-4 gap-1.5">
              <button
                v-for="opt in maxItemsOptions"
                :key="opt.value"
                type="button"
                class="flex min-h-10 items-center justify-center rounded-xl border text-xs font-medium transition-colors"
                :class="
                  settings.maxItems === opt.value
                    ? 'border-primary bg-primary text-primary-foreground font-semibold shadow-2xs'
                    : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted'
                "
                @click="updateSetting('maxItems', opt.value)">
                {{ opt.label }}
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Security Section -->
      <section aria-labelledby="security-heading" class="space-y-3">
        <h2
          id="security-heading"
          class="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
          Security
        </h2>
        <div class="border-border bg-card rounded-2xl border p-4 shadow-2xs">
          <label class="flex cursor-pointer items-center justify-between">
            <div class="pr-3">
              <p class="text-foreground text-sm font-medium">Hide secrets</p>
              <p class="text-muted-foreground text-xs">
                Mask API keys and passwords with asterisks until revealed
              </p>
            </div>
            <input
              type="checkbox"
              :checked="settings.hideSecrets"
              class="accent-primary size-5 shrink-0 cursor-pointer rounded"
              @change="
                updateSetting(
                  'hideSecrets',
                  ($event.target as HTMLInputElement).checked,
                )
              " />
          </label>
        </div>
      </section>

      <!-- About Section -->
      <section aria-labelledby="about-heading" class="space-y-3">
        <h2
          id="about-heading"
          class="text-muted-foreground px-1 text-xs font-semibold tracking-wider uppercase">
          About
        </h2>
        <div
          class="border-border bg-card text-muted-foreground space-y-3 rounded-2xl border p-4 text-xs shadow-2xs">
          <div class="flex items-center justify-between py-0.5">
            <span class="text-foreground font-medium">Version</span>
            <span>0.1.0-preview (Android)</span>
          </div>
          <div class="border-border/40 border-t" />
          <div class="flex items-center justify-between py-0.5">
            <span class="text-foreground font-medium">Capacitor Bridge</span>
            <span>8.6.2</span>
          </div>
          <div class="border-border/40 border-t" />
          <a
            href="https://github.com/theCodeD3vil/teneo"
            target="_blank"
            rel="noopener noreferrer"
            class="text-primary flex items-center justify-between py-0.5 hover:underline">
            <span>GitHub repository</span>
            <IconExternalLink class="size-3.5" />
          </a>
        </div>
      </section>

      <div class="safe-area-bottom-spacer" />
    </main>

    <!-- Unpair Confirmation Modal -->
    <Teleport to="body">
      <div
        v-if="showUnpairConfirm"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5 backdrop-blur-xs"
        role="alertdialog"
        aria-modal="true"
        aria-label="Confirm unpair">
        <div
          class="border-border bg-background w-full max-w-sm rounded-3xl border p-6 shadow-2xl">
          <h3 class="text-foreground text-base font-bold">Unpair this Mac?</h3>
          <p class="text-muted-foreground mt-2 text-xs leading-relaxed">
            Teneo will stop syncing clipboard history with this device until you
            pair again.
          </p>
          <div class="mt-6 flex justify-end gap-3">
            <button
              class="text-muted-foreground hover:bg-muted active:bg-muted/80 h-11 rounded-xl px-4 text-xs font-semibold"
              @click="showUnpairConfirm = false">
              Cancel
            </button>
            <button
              class="bg-destructive text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80 h-11 rounded-xl px-4 text-xs font-semibold"
              @click="handleUnpair">
              Unpair
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

.safe-area-bottom-spacer {
  height: max(
    2.5rem,
    calc(var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 1.5rem)
  );
}
</style>
