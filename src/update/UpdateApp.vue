<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import { ref } from "vue";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";

import ReleaseNotes from "./ReleaseNotes.vue";

const update = ref<TinyUpdateInfo | null>(null);
void tiny.api
  .call("availableUpdate")
  .then((info: TinyUpdateInfo | null) => (update.value = info));

const isInstalling = ref(false);
const didInstallFail = ref(false);

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
    await tiny.api.call("update.install");
  } catch {
    didInstallFail.value = true;
    isInstalling.value = false;
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

    <footer class="mt-auto flex shrink-0 items-center gap-x-2 pt-5">
      <p v-if="didInstallFail" class="text-destructive text-xs">
        Couldn't install the update. Try again later.
      </p>
      <Button
        variant="secondary"
        class="ml-auto"
        :disabled="isInstalling"
        @click="remindLater">
        Later
      </Button>
      <Button :disabled="isInstalling" @click="install">
        <template v-if="isInstalling"><Spinner /> Installing…</template>
        <template v-else>Install and Relaunch</template>
      </Button>
    </footer>
  </div>
</template>
