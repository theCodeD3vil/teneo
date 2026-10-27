<script setup lang="ts">
import { onKeyStroke } from "@vueuse/core";
import { defineAsyncComponent } from "vue";
import BackIcon from "~icons/tabler/chevron-left";
import PinIcon from "~icons/tabler/pin";
import PinOffIcon from "~icons/tabler/pinned-off";
import DeleteIcon from "~icons/tabler/trash";

import { useHotkeyPreview } from "@/composables/useHotkeyPreview";
import { getPreviewHotkeyProgress } from "@/constants/hotkeys";
import type { ClipboardHistoryItem } from "@/types/clipboard";
import { isInMenu } from "@/utils/keyboard";

import BetaBadge from "./BetaBadge.vue";
import HotkeyPreview from "./HotkeyPreview.vue";
import LinkPreview from "./LinkPreview.vue";
import MediaPreview from "./MediaPreview.vue";
import TextPreview from "./TextPreview.vue";
import Button from "./ui/button/Button.vue";
import Kbd from "./ui/kbd/Kbd.vue";

// Loaded on the first color preview: the color library stays out of the panel's startup
const ColorPreview = defineAsyncComponent(() => import("./ColorPreview.vue"));

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

const emit = defineEmits<{
  (e: "back"): void;
}>();

// Space toggles the preview like Quick Look and ← goes back like a page would;
// dedupe ignores a held key
onKeyStroke(
  ["Escape", " ", "ArrowLeft"],
  (event) => {
    if (isInMenu(event.target)) return;
    event.preventDefault();
    emit("back");
  },
  { dedupe: true },
);

// The pressed back key flashes here while the preview slides out
const { hotkeyProgress } = useHotkeyPreview(getPreviewHotkeyProgress);

function togglePin(): void {
  void tiny.api
    .call("pinClipboardItem", { id: props.item.id, pinned: !props.item.pinned })
    .catch(() => undefined);
}

// The preview closes itself once the item leaves the history (see App.vue)
function deleteItem(): void {
  void tiny.api
    .call("deleteClipboardItem", { id: props.item.id })
    .catch(() => undefined);
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-foreground/70"
          aria-label="Back to clipboard history"
          @click="emit('back')">
          <BackIcon />
        </Button>
        <BetaBadge />
      </div>
      <div class="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-foreground/70"
          :aria-label="item.pinned ? 'Unpin' : 'Pin'"
          @click="togglePin">
          <PinOffIcon v-if="item.pinned" />
          <PinIcon v-else />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          class="text-foreground/70 hover:text-destructive"
          aria-label="Delete"
          @click="deleteItem">
          <DeleteIcon />
        </Button>
      </div>
    </div>

    <LinkPreview v-if="item.link" :url="item.link.url" />
    <TextPreview v-else-if="item.kind === 'text'" :item="item" />
    <MediaPreview
      v-else-if="item.kind === 'image' || item.kind === 'files'"
      :item="item" />
    <ColorPreview v-else :item="item" />

    <!-- same place and motion as the list's footer hints -->
    <div class="flex h-9 shrink-0 items-center justify-center">
      <Transition
        mode="out-in"
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="translate-y-1 opacity-0 scale-95"
        leave-active-class="transition-all duration-150 ease-in"
        leave-to-class="-translate-y-1 opacity-0 scale-95">
        <HotkeyPreview v-if="hotkeyProgress" :progress="hotkeyProgress" />
        <div v-else class="text-foreground/70 flex items-center gap-1 text-xs">
          <Kbd class="bg-foreground/10 dark:bg-foreground/15">Esc</Kbd>
          <div class="divide"></div>
          <Kbd class="bg-foreground/10 dark:bg-foreground/15">Space</Kbd>

          <Kbd class="bg-foreground/10 dark:bg-foreground/15">
            <BackIcon />
          </Kbd>
          to go back
        </div>
      </Transition>
    </div>
  </div>
</template>
