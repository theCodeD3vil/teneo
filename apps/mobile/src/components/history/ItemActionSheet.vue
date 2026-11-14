<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import { computed } from "vue";
import CopyIcon from "~icons/tabler/copy";
import OpenIcon from "~icons/tabler/eye";
import PinIcon from "~icons/tabler/pin";
import PinOffIcon from "~icons/tabler/pinned-off";
import ShareIcon from "~icons/tabler/share";
import DeleteIcon from "~icons/tabler/trash";

import { useClient } from "../../client";
import { showCopiedNotice } from "../../composables/useCopiedNotice";
import { useSettings } from "../../composables/useSettings";
import { shareItem } from "../../utils/share";
import BottomSheet from "../BottomSheet.vue";
import SheetGroup from "../SheetGroup.vue";

/** What a long press on a clipboard card offers. */
const props = defineProps<{
  item: ClipboardHistoryItem | null;
}>();

const emit = defineEmits<{
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const isOpen = defineModel<boolean>("open", { required: true });

const client = useClient();
const { settings } = useSettings();

const title = computed(() => {
  const item = props.item;
  if (!item) return "";
  if (item.link) return "Link";
  if (item.color) return "Color";
  if (item.kind === "image") return "Image";
  if (item.kind === "files") {
    return item.paths.length > 1 ? `${item.paths.length} files` : "File";
  }
  return "Text";
});

// the start of what was copied, so it's clear which item this is
const previewLength = 120;
const preview = computed(() => {
  const item = props.item;
  if (!item) return undefined;
  if (item.kind === "files") return item.paths[0]?.split("/").pop();
  if (item.kind === "image") return item.sourceApp?.name ?? undefined;
  const text = item.text ?? "";
  const shown = settings.value.hideSecrets
    ? maskSecrets(text, item.secrets)
        .map((part) => part.text)
        .join("")
    : text;
  return shown.length > previewLength
    ? `${shown.slice(0, previewLength)}…`
    : shown;
});

function run(action: (item: ClipboardHistoryItem) => unknown): void {
  const item = props.item;
  isOpen.value = false;
  if (item) void Promise.resolve(action(item)).catch(() => undefined);
}

const copy = (item: ClipboardHistoryItem) =>
  client.copyToClipboard(item.id).then(showCopiedNotice);
const togglePin = (item: ClipboardHistoryItem) =>
  client.setPinned(item.id, !item.pinned);
const remove = (item: ClipboardHistoryItem) => client.deleteItem(item.id);

const rowClass =
  "active:bg-foreground/5 flex h-12 w-full items-center gap-x-3 px-4 text-left text-sm transition-colors [&_svg]:size-5";
</script>

<template>
  <BottomSheet v-model:open="isOpen" :title="title" :description="preview">
    <div v-if="props.item" class="grid gap-3">
      <SheetGroup>
        <button type="button" :class="rowClass" @click="run(copy)">
          <CopyIcon class="text-foreground/70" /> Copy
        </button>
        <button
          type="button"
          :class="rowClass"
          @click="run((item) => emit('preview', item))">
          <OpenIcon class="text-foreground/70" /> Preview
        </button>
        <button type="button" :class="rowClass" @click="run(togglePin)">
          <template v-if="props.item.pinned">
            <PinOffIcon class="text-foreground/70" /> Unpin
          </template>
          <template v-else>
            <PinIcon class="text-foreground/70" /> Pin
          </template>
        </button>
        <button type="button" :class="rowClass" @click="run(shareItem)">
          <ShareIcon class="text-foreground/70" /> Share
        </button>
      </SheetGroup>
      <SheetGroup>
        <button
          type="button"
          :class="[rowClass, 'text-destructive']"
          @click="run(remove)">
          <DeleteIcon /> Delete
        </button>
      </SheetGroup>
    </div>
  </BottomSheet>
</template>
