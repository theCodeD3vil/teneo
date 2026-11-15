<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useUpdates } from "../composables/useUpdates";
import type { Update } from "../updates/releases";
import { formatSize } from "../updates/updater";
import BottomSheet from "./BottomSheet.vue";
import UpdateProgress from "./UpdateProgress.vue";

/** Offers a new version when the app opens, at most once a day, if "Check
 *  for updates" is on; the Mac opens its update window the same way. */
const client = useClient();
const { currentState } = useNavigation();
const {
  state,
  check,
  checkIfDue,
  install,
  cancel,
  dismiss,
  askToNotify,
  onOpenedFromNotification,
} = useUpdates();

const offered = ref<Update | null>(null);
const isOpen = ref(false);

async function lookIfDue(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  try {
    if (!(await client.getSettings()).checkForUpdates) return;
  } catch {
    return;
  }
  // first-run setup has enough to say, and to ask
  const isSettingUp = () => currentState.value.screen === "setup";
  // updates found while the app is closed are said in a notification
  if (!isSettingUp()) void askToNotify();
  const update = await checkIfDue();
  if (!update || isSettingUp()) return;
  offered.value = update;
  isOpen.value = true;
}

// A tap on the notification that says an update is available: show it,
// whether or not it was offered before
async function showUpdate(): Promise<void> {
  const update = await check();
  if (!update) return;
  offered.value = update;
  isOpen.value = true;
}

let stopListening: (() => void) | undefined;
onMounted(() => {
  void lookIfDue();
  document.addEventListener("visibilitychange", lookIfDue);
  stopListening = onOpenedFromNotification(() => void showUpdate());
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", lookIfDue);
  stopListening?.();
});

// Android's installer takes over from here
watch(
  () => state.value.kind,
  (kind) => {
    if (kind === "installing") isOpen.value = false;
  },
);

const title = computed(() =>
  offered.value ? `Teneo ${offered.value.version} is available` : "",
);
const description = computed(() => {
  const now = state.value;
  if (now.kind === "needs_permission") {
    return "Allow Teneo to install apps in the settings that opened, then come back and tap Update.";
  }
  if (now.kind === "failed") return now.message;
  if (!offered.value) return "";
  return `You have ${__APP_VERSION__}. The download is ${formatSize(offered.value.size)}.`;
});
const isDownloading = computed(() => state.value.kind === "downloading");

function later(): void {
  if (offered.value) dismiss(offered.value);
  isOpen.value = false;
}
</script>

<template>
  <BottomSheet v-model:open="isOpen" :title="title" :description="description">
    <div class="grid gap-3 pt-2">
      <div
        v-if="state.kind === 'downloading'"
        class="bg-card rounded-[1.5rem] px-[1.125rem] py-4">
        <UpdateProgress :received="state.received" :size="state.update.size" />
      </div>
      <button
        type="button"
        class="sheet-button bg-cta text-cta-foreground disabled:bg-muted disabled:text-muted-foreground"
        :disabled="isDownloading"
        @click="install()">
        {{ isDownloading ? "Downloading…" : "Update" }}
      </button>
      <button
        v-if="isDownloading"
        type="button"
        class="sheet-button border-input bg-card border"
        @click="cancel()">
        Cancel
      </button>
      <button
        v-else
        type="button"
        class="sheet-button border-input bg-card border"
        @click="later">
        Later
      </button>
    </div>
  </BottomSheet>
</template>
