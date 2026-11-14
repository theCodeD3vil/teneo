<script lang="ts" setup>
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import Button from "@teneo/ui/components/button/Button.vue";
import { currentTime } from "@teneo/ui/composables/useRelativeTimeAgo";
import { cn } from "@teneo/ui/lib/utils";
import { formatFileSize } from "@teneo/ui/utils/file-size";
import { maskSecrets, type TextPart } from "@teneo/ui/utils/secrets";
import { formatTimeAgo } from "@vueuse/core";
import { computed, onUnmounted, ref } from "vue";
import TextAlignLeftIcon from "~icons/tabler/align-left";
import OpenIcon from "~icons/tabler/chevron-right";
import ClipboardIcon from "~icons/tabler/clipboard";
import FileIcon from "~icons/tabler/file";
import LinkIcon from "~icons/tabler/link";
import ImageIcon from "~icons/tabler/photo";

import { useClient } from "../../client";
import { showCopiedNotice } from "../../composables/useCopiedNotice";
import { useSettings } from "../../composables/useSettings";
import BetaBadge from "../BetaBadge.vue";

const props = defineProps<{
  itemDetails: ClipboardHistoryItem;
  /** its menu is open */
  isActive?: boolean;
}>();

const emit = defineEmits<{
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const client = useClient();
const { settings } = useSettings();

const isCopying = ref(false);
// Bumped on each copy so the sweep across the card plays again
const shimmerKey = ref(0);
let copyFinishedTimeout: ReturnType<typeof setTimeout> | undefined;

function getClipboardThemeClasses() {
  switch (props.itemDetails.kind) {
    case "text":
      return "bg-success/10 text-success";
    case "files":
      return "bg-warning/10 text-warning";
    default:
      return "bg-primary/10 text-primary";
  }
}

const isImage = computed(() => props.itemDetails.kind === "image");
const isFiles = computed(() => props.itemDetails.kind === "files");
const firstPath = computed(() => props.itemDetails.paths[0]);
const fileName = computed(() => firstPath.value?.split("/").pop());
const otherFileCount = computed(() => props.itemDetails.paths.length - 1);
const fileSize = computed(() =>
  props.itemDetails.fileSize == null
    ? null
    : formatFileSize(props.itemDetails.fileSize),
);
const imageName = computed(() =>
  props.itemDetails.sourceApp?.name
    ? `Image from ${props.itemDetails.sourceApp.name}`
    : "Image",
);

const dateCopied = computed(() =>
  formatTimeAgo(
    new Date(props.itemDetails.dateCopied),
    undefined,
    currentTime.value,
  ),
);

// Secrets show as asterisks unless hiding is off in Settings; copying always
// gives the real text
const maskedTextParts = computed(() => {
  const text = props.itemDetails.text ?? "";
  return settings.value.hideSecrets
    ? maskSecrets(text, props.itemDetails.secrets)
    : [{ text }];
});
// The card shows two lines; a copy can be far longer
const cardTextLimit = 500;
const textParts = computed(() => {
  const parts: TextPart[] = [];
  let room = cardTextLimit;
  for (const part of maskedTextParts.value) {
    if (room <= 0) break;
    parts.push({ ...part, text: part.text.slice(0, room) });
    room -= part.text.length;
  }
  return parts;
});
const secretLabels = computed(() =>
  [
    ...new Set(
      maskedTextParts.value.map((part) => part.secretLabel).filter(Boolean),
    ),
  ].join(", "),
);

function copyItem(): void {
  if (isCopying.value) return;
  isCopying.value = true;
  void client
    .copyToClipboard(props.itemDetails.id)
    .then(() => {
      shimmerKey.value += 1;
      showCopiedNotice();
    })
    .catch(() => undefined)
    .finally(() => {
      copyFinishedTimeout = setTimeout(() => {
        isCopying.value = false;
      }, 1500);
    });
}

onUnmounted(() => clearTimeout(copyFinishedTimeout));
</script>

<template>
  <div
    :data-item-id="itemDetails.id"
    :data-active="isActive || undefined"
    :class="
      cn([
        'group/card active:bg-foreground/5 dark:active:bg-foreground/6 relative cursor-pointer rounded-md p-3 transition-[bg]',
        props.isActive && 'bg-foreground/5 dark:bg-foreground/6',
      ])
    "
    @click="copyItem">
    <div class="flex items-start gap-4">
      <div :class="cn(['rounded-md p-2', getClipboardThemeClasses()])">
        <LinkIcon v-if="itemDetails.link" class="size-5" />
        <TextAlignLeftIcon
          v-else-if="itemDetails.kind === 'text'"
          class="size-5" />
        <FileIcon v-else-if="isFiles" class="size-5" />
        <ImageIcon v-else-if="isImage" class="size-5" />
        <ClipboardIcon v-else class="size-5" />
      </div>
      <div class="min-w-0 flex-1 space-y-2">
        <!-- text -->
        <p
          v-if="itemDetails.kind === 'text' && itemDetails.text"
          class="line-clamp-2 text-sm wrap-break-word">
          <template v-for="(part, index) in textParts" :key="index">
            <!-- a masked key and its badge wrap as one -->
            <span v-if="part.secretLabel" class="whitespace-nowrap">
              <span class="font-mono">{{ part.text }}</span>
              <BetaBadge class="ml-1" />
            </span>
            <template v-else>{{ part.text }}</template>
          </template>
        </p>
        <!-- color (value + small preview) -->
        <p v-if="itemDetails.color" class="flex items-center gap-2 text-sm">
          <span class="font-mono font-semibold">{{ itemDetails.color }}</span>
          <span
            class="size-4 rounded"
            :style="{ background: itemDetails.color }" />
        </p>
        <!-- file -->
        <p
          v-if="isFiles"
          class="flex items-center gap-2 text-sm whitespace-nowrap">
          <span class="truncate">{{ fileName }}</span>
          <span v-if="otherFileCount > 0" class="text-foreground/50 text-xs"
            >+{{ otherFileCount }}</span
          >
        </p>
        <!-- image -->
        <p v-if="isImage" class="max-w-[70%] truncate text-sm">
          {{ imageName }}
        </p>

        <!-- one line: where it came from, size, date, secrets -->
        <div
          class="text-foreground/50 flex items-center gap-x-2 text-xs whitespace-nowrap">
          <span v-if="itemDetails.sourceApp" class="min-w-0 truncate">
            {{ itemDetails.sourceApp.name }}
          </span>
          <template v-if="fileSize">
            <span v-if="itemDetails.sourceApp">·</span>
            <span>{{ fileSize }}</span>
          </template>
          <template v-if="itemDetails.dateCopied">
            <span v-if="itemDetails.sourceApp || fileSize">·</span>
            <span>{{ dateCopied }}</span>
          </template>
          <template v-if="secretLabels">
            <span>·</span>
            <span class="min-w-0 flex-1 truncate">{{ secretLabels }}</span>
          </template>
        </div>
      </div>
      <!-- tapping the card copies; this opens the preview -->
      <Button
        variant="ghost"
        size="icon"
        aria-label="Open"
        class="text-foreground/50 -my-1 -mr-1.5 shrink-0 self-center"
        @click.stop="emit('preview', itemDetails)">
        <OpenIcon />
      </Button>
    </div>
    <!-- a light sweeps across the card just copied, so it's clear which one -->
    <div
      v-if="shimmerKey"
      :key="shimmerKey"
      class="pointer-events-none absolute inset-0 overflow-hidden rounded-md motion-reduce:hidden">
      <div
        class="animate-copy-shimmer via-success/20 absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent to-transparent"
        @animationend="shimmerKey = 0" />
    </div>
  </div>
</template>
