<script lang="ts" setup>
import { computed, onUnmounted, ref } from "vue";
import TextAlignLeftIcon from "~icons/tabler/align-left";
import ClipboardIcon from "~icons/tabler/clipboard";
import CommandIcon from "~icons/tabler/command";
import FileIcon from "~icons/tabler/file";
import LinkIcon from "~icons/tabler/link";
import ImageIcon from "~icons/tabler/photo";
import PinIcon from "~icons/tabler/pin";
import PinOffIcon from "~icons/tabler/pinned-off";
import DeleteIcon from "~icons/tabler/trash";

import BetaBadge from "@/components/BetaBadge.vue";
import Button from "@/components/ui/button/Button.vue";
import { getPreviewPath } from "@/composables/useItemPreviews";
import { useRelativeTimeAgo } from "@/composables/useRelativeTimeAgo";
import { useSettings } from "@/composables/useSettings";
import { cn } from "@/lib/utils";
import type { ClipboardHistoryItem, FilePreview } from "@/types/clipboard";
import { getClipboardData, getImageName } from "@/utils/clipboard-items";
import { copyItemToClipboard } from "@/utils/copy-item";
import { formatFileSize } from "@/utils/file-size";
import { maskSecrets, type TextPart } from "@/utils/secrets";

const props = defineProps<{
  itemDetails: ClipboardHistoryItem;
  isActive?: boolean;
  supportsQuickPaste?: boolean;
  quickPasteIndex?: number;
  // From the list's queries (useItemPreviews); undefined until they load
  sourceAppIconUrl?: string | null;
  filePreview?: FilePreview;
  linkPreviewUrl?: string | null;
}>();

const emit = defineEmits<{
  // carries its item so the list can pass one handler to every card
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

// Only what the card itself is clicked for lives here. The keys (Enter, ⌘1-9,
// D, P) act through the list: with only the cards on screen in the page, the
// card for a key's item may not be there at all (see AllTabContent).
const isCopying = ref(false);
// Bumped on each copy so the sweep across the card plays again
const shimmerKey = ref(0);
let copyFinishedTimeout: ReturnType<typeof setTimeout> | undefined;
let clickCopyTimeout: ReturnType<typeof setTimeout> | undefined;
// How long a click waits to see if it's the start of a double-click
const doubleClickWait = 250;

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

// The app icon and preview load after the list shows, so a card never waits on
// the backend (see useItemPreviews). Images and files are previewed from disk:
// the preview is a data: URL, or null when that file was moved or deleted since
// it was copied; until it loads, the kind icon holds its place at the same size.
const sourceAppBundleId = props.itemDetails.sourceApp?.bundleId;
const isImage = props.itemDetails.kind === "image";
const isFiles = props.itemDetails.kind === "files";
const firstPath = props.itemDetails.paths[0];
const previewPath = getPreviewPath(props.itemDetails);

const previewUrl = computed(() => props.filePreview?.url ?? null);
// macOS keeps Teneo out of the file's folder: no preview, but it still pastes
const isFolderBlocked = computed(
  () => isFiles && props.filePreview?.isMissing === false && !previewUrl.value,
);

// A link shows its site's icon, fetched by the backend from the site itself.
// Until it loads, or when previews are off, the link icon holds its place.
const link = props.itemDetails.link;
const { settings } = useSettings();

const mediaUrl = computed(
  () =>
    previewUrl.value ??
    (settings.value.showLinkPreviews ? (props.linkPreviewUrl ?? null) : null),
);

const isPreviewMissing = computed(
  () => (isImage || isFiles) && (!previewPath || props.filePreview?.isMissing),
);

const fileName = firstPath?.split("/").pop();
const otherFileCount = props.itemDetails.paths.length - 1;

// comes with the history list, so the line under the name never shifts
const fileSize = computed(() =>
  props.itemDetails.fileSize == null
    ? null
    : formatFileSize(props.itemDetails.fileSize),
);

const dateCopied = useRelativeTimeAgo(props.itemDetails.dateCopied);

// Secrets in the text show as asterisks unless masking is off in Settings; copying
// and pasting always give the real text
const maskedTextParts = computed(() => {
  const text = props.itemDetails.text ?? "";
  return settings.value.maskSecrets
    ? maskSecrets(text, props.itemDetails.secrets)
    : [{ text }];
});
// The card shows two lines, but a copy can be megabytes of text. Kept whole
// in the page, it made every click in the panel take a second or more:
// WebKit's Look Up hit test walks the text one character at a time.
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

const imageName = getImageName(props.itemDetails);

// A click copies once it's clear no second click follows; a double-click
// previews instead. event.detail counts the clicks in a row.
function handleClick(event: MouseEvent): void {
  clearTimeout(clickCopyTimeout);
  if (event.detail > 1) return;
  clickCopyTimeout = setTimeout(() => copyItem(), doubleClickWait);
}

function copyItem(): void {
  if (isPreviewMissing.value || isCopying.value) return;
  if (!getClipboardData(props.itemDetails)) return;

  isCopying.value = true;
  void copyItemToClipboard(props.itemDetails)
    .then((copied) => {
      if (copied) shimmerKey.value += 1;
    })
    .catch(() => undefined)
    .finally(() => {
      copyFinishedTimeout = setTimeout(() => {
        isCopying.value = false;
      }, 1500);
    });
}

// Soft delete: the history refreshes once the backend reports the change
function deleteItem(): boolean {
  void tiny.api
    .call("deleteClipboardItem", { id: props.itemDetails.id })
    .catch(() => undefined);
  return true;
}

// Toggles: P and the button unpin an already pinned item
function pinItem(): boolean {
  void tiny.api
    .call("pinClipboardItem", {
      id: props.itemDetails.id,
      pinned: !props.itemDetails.pinned,
    })
    .catch(() => undefined);
  return true;
}

onUnmounted(() => {
  clearTimeout(copyFinishedTimeout);
  clearTimeout(clickCopyTimeout);
});
</script>
<template>
  <div
    :data-active="isActive || undefined"
    @click="handleClick"
    @dblclick="emit('preview', itemDetails)"
    :class="
      cn([
        'group/card hover:bg-foreground/5 dark:hover:bg-foreground/6 relative cursor-pointer rounded-md p-3 transition-[bg]',
        props.isActive && 'bg-foreground/5 dark:bg-foreground/6',
      ])
    ">
    <div class="flex items-start gap-4">
      <!-- media -->
      <div v-if="mediaUrl" class="size-9 shrink-0">
        <!-- a link's icon fills the square like an app icon -->
        <img
          :src="mediaUrl"
          :alt="isImage ? imageName : isFiles ? fileName : link?.host"
          :class="
            cn([
              'size-full rounded-md',
              isFiles ? 'object-contain' : 'object-cover',
            ])
          " />
      </div>
      <div
        v-else
        :class="cn(['rounded-md p-2', getClipboardThemeClasses()])"
        :title="
          isFolderBlocked
            ? 'Allow Teneo to see this folder in System Settings › Privacy & Security › Files and Folders to preview it'
            : undefined
        ">
        <LinkIcon v-if="link" class="size-5" />
        <TextAlignLeftIcon
          v-else-if="itemDetails.kind === 'text'"
          class="size-5" />
        <FileIcon v-else-if="itemDetails.kind === 'files'" class="size-5" />
        <ImageIcon v-else-if="itemDetails.kind === 'image'" class="size-5" />
        <ClipboardIcon v-else class="size-5" />
      </div>
      <!-- main content -->
      <div class="min-w-0 flex-1 space-y-2">
        <!-- text -->
        <p
          class="font-foreground line-clamp-2 text-sm wrap-break-word"
          v-if="itemDetails.kind === 'text' && itemDetails.text">
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
        <p
          class="font-foreground flex items-center gap-2 text-sm"
          v-if="itemDetails.color">
          <span class="font-mono font-semibold">
            {{ itemDetails.color }}
          </span>
          <span
            class="size-4 rounded"
            :style="`background: ${itemDetails.color}`"></span>
        </p>
        <!-- file -->
        <p
          v-if="isFiles"
          class="font-foreground flex items-center gap-2 text-sm whitespace-nowrap"
          :title="firstPath">
          <span
            :class="
              cn([
                'truncate',
                isPreviewMissing && 'text-foreground/50 line-through',
              ])
            ">
            {{ fileName }}
          </span>
          <span v-if="otherFileCount > 0" class="text-foreground/50 text-xs"
            >+{{ otherFileCount }}</span
          >
          <span v-if="isPreviewMissing" class="text-foreground/50 text-xs"
            >File no longer exists</span
          >
        </p>
        <!-- image -->
        <p
          v-if="isImage"
          :class="
            cn([
              'font-foreground max-w-[70%] truncate text-sm',
              isPreviewMissing && 'text-foreground/50 line-through',
            ])
          ">
          {{ imageName }}
        </p>
        <p
          v-if="isImage && (isPreviewMissing || itemDetails.imageSize)"
          class="text-foreground/50 text-xs">
          {{
            isPreviewMissing
              ? "Image no longer exists"
              : `${itemDetails.imageSize?.width} × ${itemDetails.imageSize?.height}`
          }}
        </p>

        <!-- one line: the link host and the paths shrink and truncate, the rest
             (app, size, date) keep their words together instead of wrapping -->
        <div class="flex items-center gap-x-2 whitespace-nowrap">
          <!-- shown while the icon loads, its place kept, so the line doesn't shift -->
          <span
            v-if="sourceAppBundleId && sourceAppIconUrl !== null"
            class="text-foreground/50 flex items-center gap-x-1 text-xs">
            <img
              :src="sourceAppIconUrl"
              :class="
                cn([
                  'aspect-square size-4 overflow-hidden rounded',
                  !sourceAppIconUrl && 'invisible',
                ])
              " />
            {{ itemDetails.sourceApp?.name }}
          </span>
          <template v-if="fileSize">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 text-xs">{{ fileSize }}</span>
          </template>
          <!-- <template v-if="link">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 min-w-0 truncate text-xs">{{
              link.host
            }}</span>
          </template> -->
          <template v-if="itemDetails.dateCopied">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 text-xs">{{ dateCopied }}</span>
          </template>
          <template v-if="secretLabels">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 min-w-0 flex-1 truncate text-xs">
              {{ secretLabels }}</span
            >
          </template>
          <template v-if="isFiles && firstPath">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 min-w-0 flex-1 truncate text-xs">
              {{ firstPath }}</span
            >
          </template>
        </div>
      </div>
      <!-- quick paste, swapped for the actions when hovered or selected; both share one grid cell so nothing shifts -->
      <div class="grid shrink-0 place-items-center p-2">
        <div
          class="bg-foreground/1 text-foreground/60 actions-visible:invisible col-start-1 row-start-1 flex w-max items-center gap-0.5 rounded p-1"
          v-if="supportsQuickPaste">
          <CommandIcon />
          <span class="text-xs">{{ quickPasteIndex }}</span>
        </div>
        <div
          class="actions-visible:opacity-100 col-start-1 row-start-1 flex items-center gap-1 opacity-0">
          <Button
            variant="ghost"
            size="icon-sm"
            :title="itemDetails.pinned ? 'Unpin' : 'Pin'"
            class="text-foreground/60 hover:text-foreground hover:bg-foreground/10! dark:hover:bg-foreground/15!"
            @click.stop="pinItem"
            @dblclick.stop>
            <PinOffIcon v-if="itemDetails.pinned" />
            <PinIcon v-else />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            class="text-foreground/60 hover:text-destructive hover:bg-destructive/10! dark:hover:bg-destructive/20!"
            @click.stop="deleteItem"
            @dblclick.stop>
            <DeleteIcon />
          </Button>
        </div>
      </div>
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
