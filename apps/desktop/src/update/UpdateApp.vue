<script setup lang="ts">
import {
  type UpdateProgress,
  updateProgressEvent,
} from "@teneo/shared/types/windows";
import { Button } from "@teneo/ui/components/button";
import { ScrollArea } from "@teneo/ui/components/scroll-area";
import { onKeyStroke } from "@vueuse/core";
import { computed, ref } from "vue";

import TransferProgress from "@/components/TransferProgress.vue";
import { showWindowWhenPainted } from "@/lib/window-ready";

import ReleaseNotes from "./ReleaseNotes.vue";

const update = ref<TinyUpdateInfo | null>(null);
const updateLoaded = tiny.api
  .call("availableUpdate")
  .then((info: TinyUpdateInfo | null) => (update.value = info));
// The window opened hidden; surface it with the update already on screen
void showWindowWhenPainted(updateLoaded);

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
  <div
    class="window-frame flex h-screen flex-col overflow-hidden bg-transparent! px-6 pb-6 dark:bg-black/55!">
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
      class="border-foreground/8 bg-foreground/4 dark:bg-foreground/6 min-h-0 flex-1 rounded-xl border">
      <ReleaseNotes :markdown="update.notes" class="px-5 py-4" />
    </ScrollArea>

    <!-- same height in both states, so the notes don't jump -->
    <footer class="mt-auto flex h-14 shrink-0 items-end">
      <TransferProgress
        v-if="isInstalling"
        class="h-9"
        :label="isDownloaded ? 'Installing…' : 'Downloading…'"
        progress-label="Update progress"
        :received="progress?.received"
        :total="progress?.total"
        :finalizing="isDownloaded" />

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
