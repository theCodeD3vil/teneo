<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";

import { useClient } from "../client";
import { useNavigation } from "../composables/useNavigation";
import { useUpdates } from "../composables/useUpdates";
import type { Update } from "../updates/releases";
import { formatSize } from "../updates/updater";
import BottomSheet from "./BottomSheet.vue";

/** Offers a new version when the app opens, at most once a day, if "Check
 *  for updates" is on; the Mac opens its update window the same way. */
const client = useClient();
const { currentState } = useNavigation();
const { state, checkIfDue, install, cancel, openInBrowser, dismiss } =
  useUpdates();

const offered = ref<Update | null>(null);
const isOpen = ref(false);

async function lookIfDue(): Promise<void> {
  if (document.visibilityState !== "visible") return;
  try {
    if (!(await client.getSettings()).checkForUpdates) return;
  } catch {
    return;
  }
  const update = await checkIfDue();
  // first-run setup has enough to say
  if (!update || currentState.value.screen === "setup") return;
  offered.value = update;
  isOpen.value = true;
}

onMounted(() => {
  void lookIfDue();
  document.addEventListener("visibilitychange", lookIfDue);
});
onUnmounted(() => {
  document.removeEventListener("visibilitychange", lookIfDue);
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
  if (now.kind === "downloading" && offered.value) {
    const percent = Math.floor((now.received / offered.value.size) * 100);
    return `Downloading… ${Math.min(percent, 100)}%`;
  }
  if (now.kind === "needs_permission") {
    return "Allow Teneo to install apps in the settings that opened, then come back and tap Update.";
  }
  if (now.kind === "failed") return now.message;
  if (!offered.value) return "";
  return `You have ${__APP_VERSION__}. The download is ${formatSize(offered.value.size)}.`;
});
const isDownloading = computed(() => state.value.kind === "downloading");
const canUseBrowser = computed(
  () =>
    state.value.kind === "failed" || state.value.kind === "needs_permission",
);

function later(): void {
  if (offered.value) dismiss(offered.value);
  isOpen.value = false;
}
</script>

<template>
  <BottomSheet v-model:open="isOpen" :title="title" :description="description">
    <div class="grid gap-2 pt-2">
      <Button class="h-12 text-sm" :disabled="isDownloading" @click="install()">
        {{ isDownloading ? "Downloading…" : "Update" }}
      </Button>
      <Button
        v-if="isDownloading"
        variant="secondary"
        class="h-12 text-sm"
        @click="cancel()">
        Cancel
      </Button>
      <Button v-else variant="secondary" class="h-12 text-sm" @click="later">
        Later
      </Button>
      <Button
        v-if="canUseBrowser"
        variant="ghost"
        class="h-12 text-sm"
        @click="openInBrowser()">
        Download in the browser instead
      </Button>
    </div>
  </BottomSheet>
</template>
