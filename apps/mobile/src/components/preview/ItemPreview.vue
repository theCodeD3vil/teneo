<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { defineAsyncComponent, onUnmounted, ref, watch } from "vue";
import TickIcon from "~icons/tabler/check";
import BackIcon from "~icons/tabler/chevron-left";
import CopyIcon from "~icons/tabler/copy";
import PinIcon from "~icons/tabler/pin";
import PinOffIcon from "~icons/tabler/pinned-off";
import ShareIcon from "~icons/tabler/share";
import DeleteIcon from "~icons/tabler/trash";

import { useClient } from "../../client";
import { showCopiedNotice } from "../../composables/useCopiedNotice";
import { shareItem } from "../../utils/share";
import LinkPreview from "./LinkPreview.vue";
import TextPreview from "./TextPreview.vue";

// Loaded on the first colour preview: the colour library stays out of the
// app's startup
const ColorPreview = defineAsyncComponent(() => import("./ColorPreview.vue"));

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

const emit = defineEmits<{
  (e: "back"): void;
}>();

const client = useClient();

// The text as the preview shows it after tidying or formatting; null copies
// the item
const convertedText = ref<string | null>(null);
watch(
  () => props.item.id,
  () => (convertedText.value = null),
);

// a round button in the bar at the foot of the preview
const actionClass =
  "grid size-[3rem] place-items-center rounded-full transition-colors active:bg-cta-foreground/15 [&_svg]:size-[1.375rem]";

const isCopied = ref(false);
let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

async function copy(): Promise<void> {
  try {
    if (convertedText.value !== null) {
      await client.copyText(convertedText.value);
    } else {
      await client.copyToClipboard(props.item.id);
    }
  } catch {
    return;
  }
  showCopiedNotice();
  isCopied.value = true;
  clearTimeout(copiedTimeout);
  copiedTimeout = setTimeout(() => (isCopied.value = false), 1500);
}

function share(): void {
  void shareItem(props.item).catch(() => undefined);
}

function togglePin(): void {
  void client
    .setPinned(props.item.id, !props.item.pinned)
    .catch(() => undefined);
}

// The screen goes back once the item leaves the history (see ItemViewScreen)
function deleteItem(): void {
  void client.deleteItem(props.item.id).catch(() => undefined);
}

onUnmounted(() => clearTimeout(copiedTimeout));
</script>

<template>
  <!-- positioned, so a text's actions can sit in the top bar's free end -->
  <div class="relative flex min-h-0 flex-1 flex-col gap-4">
    <div class="flex shrink-0 items-center gap-[0.625rem]">
      <button
        type="button"
        class="round-button"
        aria-label="Back to clipboard history"
        @click="emit('back')">
        <BackIcon />
      </button>
    </div>

    <LinkPreview v-if="item.link" :url="item.link.url" />
    <TextPreview
      v-else-if="item.kind === 'text'"
      v-model:converted-text="convertedText"
      :item="item" />
    <ColorPreview v-else-if="item.color" :color="item.color" />
    <div
      v-else-if="item.kind === 'image' && item.image"
      class="flex min-h-0 flex-1 items-center justify-center">
      <img
        :src="item.image"
        alt=""
        class="max-h-full max-w-full rounded-[2rem] object-contain" />
    </div>
    <div
      v-else
      class="text-muted-foreground flex flex-1 items-center justify-center text-sm">
      This item can't be previewed on your phone yet.
    </div>

    <!-- what can be done with the item, in one bar: copying it leads -->
    <div
      class="bg-cta text-cta-foreground flex h-[4rem] shrink-0 items-center justify-between rounded-full p-2">
      <div class="flex items-center gap-1">
        <button
          type="button"
          :class="actionClass"
          :aria-label="item.pinned ? 'Unpin' : 'Pin'"
          @click="togglePin">
          <PinOffIcon v-if="item.pinned" />
          <PinIcon v-else />
        </button>
        <button
          type="button"
          :class="actionClass"
          aria-label="Share"
          @click="share">
          <ShareIcon />
        </button>
        <button
          type="button"
          :class="[actionClass, 'text-[#ff9a8f] dark:text-[#b3261e]']"
          aria-label="Delete"
          @click="deleteItem">
          <DeleteIcon />
        </button>
      </div>
      <button
        type="button"
        class="bg-primary text-primary-foreground font-heading flex h-[3rem] items-center gap-2 rounded-full pr-5 pl-4 text-[1.0625rem] font-semibold transition-transform active:scale-[0.97] [&_svg]:size-[1.375rem]"
        @click="copy">
        <TickIcon v-if="isCopied" />
        <CopyIcon v-else />
        <Transition
          mode="out-in"
          enter-active-class="transition-all duration-200 ease-out"
          enter-from-class="translate-y-1 opacity-0"
          leave-active-class="transition-all duration-150 ease-in"
          leave-to-class="-translate-y-1 opacity-0">
          <span v-if="isCopied" key="copied">Copied</span>
          <span v-else key="copy">Copy</span>
        </Transition>
      </button>
    </div>
  </div>
</template>
