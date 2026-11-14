<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import Button from "@teneo/ui/components/button/Button.vue";
import { onUnmounted, ref, watch } from "vue";
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
import BetaBadge from "../BetaBadge.vue";
import ColorPreview from "./ColorPreview.vue";
import LinkPreview from "./LinkPreview.vue";
import TextPreview from "./TextPreview.vue";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

const emit = defineEmits<{
  (e: "back"): void;
}>();

const client = useClient();

// The text as the preview shows it after a case change; null copies the item
const convertedText = ref<string | null>(null);
watch(
  () => props.item.id,
  () => (convertedText.value = null),
);

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
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
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
          size="icon"
          class="text-foreground/70"
          :aria-label="item.pinned ? 'Unpin' : 'Pin'"
          @click="togglePin">
          <PinOffIcon v-if="item.pinned" />
          <PinIcon v-else />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-foreground/70"
          aria-label="Share"
          @click="share">
          <ShareIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          class="text-foreground/70 hover:text-destructive active:text-destructive"
          aria-label="Delete"
          @click="deleteItem">
          <DeleteIcon />
        </Button>
      </div>
    </div>

    <LinkPreview v-if="item.link" :url="item.link.url" />
    <TextPreview
      v-else-if="item.kind === 'text'"
      v-model:converted-text="convertedText"
      :item="item" />
    <ColorPreview v-else-if="item.color" :color="item.color" />
    <div
      v-else
      class="text-foreground/50 flex flex-1 items-center justify-center text-sm">
      This item can't be previewed on your phone yet.
    </div>

    <Button size="lg" class="w-full shrink-0" @click="copy">
      <Transition
        mode="out-in"
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="translate-y-1 opacity-0 scale-95"
        leave-active-class="transition-all duration-150 ease-in"
        leave-to-class="-translate-y-1 opacity-0 scale-95">
        <span v-if="isCopied" class="flex items-center gap-1.5">
          <TickIcon /> Copied
        </span>
        <span v-else class="flex items-center gap-1.5">
          <CopyIcon /> Copy
        </span>
      </Transition>
    </Button>
  </div>
</template>
