<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import { computed, ref } from "vue";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatFileSize } from "@/utils/file-size";

import {
  type UpdateProgress,
  updateProgressEvent,
} from "../../shared/types/windows";
import ReleaseNotes from "./ReleaseNotes.vue";

const update = ref<TinyUpdateInfo | null>(null);
void tiny.api
  .call("availableUpdate")
  .then((info: TinyUpdateInfo | null) => (update.value = info));

const isInstalling = ref(false);
const didInstallFail = ref(false);

const progress = ref<UpdateProgress | null>(null);
tiny.api.on(updateProgressEvent, (update: UpdateProgress) => {
  progress.value = update;
});

// After the download, the new version is checked and moved into place
const isDownloaded = computed(
  () =>
    progress.value?.total != null &&
    progress.value.received >= progress.value.total,
);
// null shows a moving bar: still connecting, size unknown, or installing
const downloadPercent = computed(() => {
  if (!progress.value?.total || isDownloaded.value) return null;
  return (progress.value.received / progress.value.total) * 100;
});

function remindLater(): void {
  if (isInstalling.value) return;
  void tiny.api.call("closeUpdate");
}

async function install(): Promise<void> {
  if (isInstalling.value) return;
  isInstalling.value = true;
  didInstallFail.value = false;
  try {
    // Downloads and checks the new version, then relaunches into it
    await tiny.api.call("installUpdate");
  } catch {
    didInstallFail.value = true;
    isInstalling.value = false;
    progress.value = null;
  }
}

// Same keys as a native alert. preventDefault stops Return from also
// clicking whichever button has focus.
onKeyStroke("Enter", (event) => {
  event.preventDefault();
  void install();
});
onKeyStroke("Escape", (event) => {
  event.preventDefault();
  remindLater();
});
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-transparent! px-6 pb-6">
    <!-- the window is frameless: the header drags the window -->
    <header data-tiny-drag class="flex shrink-0 items-center gap-x-4 pt-7 pb-5">
      <img data-tiny-drag class="size-14 shrink-0" src="/icon.png" alt="" />
      <div v-if="update" class="min-w-0">
        <h1 class="text-[15px] font-semibold">
          Teneo {{ update.latest }} is available
        </h1>
        <p class="text-foreground/55 mt-0.5 text-[13px]">
          You have {{ update.current }}.
        </p>
      </div>
    </header>

    <ScrollArea
      v-if="update?.notes"
      class="border-foreground/8 bg-foreground/4 min-h-0 flex-1 rounded-xl border">
      <ReleaseNotes :markdown="update.notes" class="px-5 py-4" />
    </ScrollArea>

    <!-- same height in both states, so the notes don't jump -->
    <footer class="mt-auto flex h-14 shrink-0 items-end">
      <div
        v-if="isInstalling"
        class="flex h-9 w-full flex-col justify-center gap-y-2">
        <div class="text-foreground/60 flex justify-between text-xs">
          <span>{{ isDownloaded ? "Installing…" : "Downloading…" }}</span>
          <span v-if="progress && !isDownloaded" class="tabular-nums">
            {{ formatFileSize(progress.received) }}
            <template v-if="progress.total">
              of {{ formatFileSize(progress.total) }}
            </template>
          </span>
        </div>
        <div
          role="progressbar"
          aria-label="Update progress"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-valuenow="downloadPercent ?? undefined"
          class="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
          <div
            v-if="downloadPercent !== null"
            class="bg-primary h-full rounded-full transition-[width] duration-200 ease-out"
            :style="{ width: `${downloadPercent}%` }" />
          <div
            v-else
            class="indeterminate bg-primary h-full w-2/5 rounded-full" />
        </div>
      </div>

      <div v-else class="flex w-full items-center gap-x-2">
        <p v-if="didInstallFail" class="text-destructive text-xs">
          Couldn't install the update. Try again later.
        </p>
        <Button variant="secondary" class="ml-auto" @click="remindLater">
          Later
        </Button>
        <Button @click="install">Install and Relaunch</Button>
      </div>
    </footer>
  </div>
</template>

<style scoped>
/* A segment sweeping across while there's no percentage to show */
.indeterminate {
  animation: sweep 1.4s ease-in-out infinite;
}
@keyframes sweep {
  from {
    transform: translateX(-100%);
  }
  to {
    transform: translateX(250%);
  }
}
</style>
