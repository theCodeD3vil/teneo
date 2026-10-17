<script lang="ts" setup>
import { onMounted, onUnmounted, ref, watch } from "vue";
import ClipboardIcon from "~icons/hugeicons/clipboard";
import CommandIcon from "~icons/hugeicons/command";
import FileIcon from "~icons/hugeicons/file-01";
import FileVerifiedIcon from "~icons/hugeicons/file-verified";
import ImageIcon from "~icons/hugeicons/image-01";
import ImageDoneIcon from "~icons/hugeicons/image-done-01";
import TextAlignLeftIcon from "~icons/hugeicons/text-align-left";
import TickIcon from "~icons/hugeicons/tick-02";

import { useHotkeys } from "@/composables/useHotkeys";
import { useRelativeTimeAgo } from "@/composables/useRelativeTimeAgo";
import type { QuickCopyItemNumber } from "@/constants/hotkeys";
import { cn } from "@/lib/utils";
import type { ClipboardHistoryItem } from "@/types/clipboard";

const props = defineProps<{
  itemDetails: ClipboardHistoryItem;
  isActive?: boolean;
  supportsQuickPaste?: boolean;
  quickPasteIndex?: number;
}>();

const cardElement = ref<HTMLElement | null>(null);
const isCopying = ref(false);
let copyFinishedTimeout: ReturnType<typeof setTimeout> | undefined;

const copyFeedbackTransition = {
  enterActiveClass: "transition-all duration-200 ease-out",
  enterFromClass: "translate-y-1 opacity-0 scale-95",
  leaveActiveClass: "transition-all duration-150 ease-in",
  leaveToClass: "-translate-y-1 opacity-0 scale-95",
};

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

// data: URL of the app's icon, or null when the app can't be found
const sourceAppIconUrl = await tiny.api.call("appIcon", {
  bundleId: props.itemDetails.sourceApp?.bundleId,
});

// Images and files are previewed from disk: the saved image copy, or the first copied file.
// A null preview means that file was moved or deleted since it was copied.
const isImage = props.itemDetails.kind === "image";
const isFiles = props.itemDetails.kind === "files";
const firstPath = props.itemDetails.paths[0];

const previewPath = isImage
  ? props.itemDetails.image
  : isFiles
    ? firstPath
    : null;

const preview: { url: string; size: number | null } | null = previewPath
  ? await tiny.api.call("filePreview", { path: previewPath })
  : null;
const previewUrl = preview?.url ?? null;

const isPreviewMissing = (isImage || isFiles) && !previewUrl;

const fileName = firstPath?.split("/").pop();
const otherFileCount = props.itemDetails.paths.length - 1;

const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];

/** Bytes in base 1000, as Finder shows them: 178523 → "178.5 kB". */
function formatFileSize(bytes: number): string {
  const unitIndex = Math.min(
    Math.floor(Math.log10(Math.max(bytes, 1)) / 3),
    SIZE_UNITS.length - 1,
  );
  return new Intl.NumberFormat(undefined, {
    style: "unit",
    unit: SIZE_UNITS[unitIndex],
    unitDisplay: "short",
    maximumFractionDigits: 1,
  }).format(bytes / 1000 ** unitIndex);
}

// Only for a single copied file: next to "+N" the first file's size would read as the total.
const fileSize =
  isFiles && otherFileCount === 0 && preview?.size != null
    ? formatFileSize(preview.size)
    : null;

const dateCopied = useRelativeTimeAgo(props.itemDetails.dateCopied);

/** Original filename from a browser copy's `<img src>` html, or null. */
function imageNameFromHtml(html: string | null): string | null {
  const src = html?.match(/<img[^>]+src=["']([^"']+)["']/i)?.[1];
  if (!src) return null;
  try {
    const { protocol, pathname } = new URL(src);
    if (protocol === "data:") return null;
    return decodeURIComponent(pathname.split("/").pop() ?? "") || null;
  } catch {
    return null; // relative or malformed src
  }
}

// Copied image data has no filename: use the browser's <img src> name when there
// is one, otherwise label the image by the app it came from.
const sourceAppName = props.itemDetails.sourceApp?.name;
const imageName =
  imageNameFromHtml(props.itemDetails.html) ??
  (sourceAppName ? `Image from ${sourceAppName}` : "Image");

function handleQuickCopy(itemNumber: QuickCopyItemNumber): boolean {
  if (
    !props.supportsQuickPaste ||
    props.quickPasteIndex !== itemNumber ||
    isPreviewMissing ||
    isCopying.value
  ) {
    return false;
  }

  const clipboardData = getClipboardDataForQuickCopy(props.itemDetails);
  if (!clipboardData) return false;

  void copyToClipboard(clipboardData).catch(() => undefined);
  return true;
}

async function copyToClipboard(
  clipboardData: TinyClipboardWrite,
): Promise<void> {
  isCopying.value = true;

  try {
    await tiny.clipboard.write(clipboardData);
  } finally {
    copyFinishedTimeout = setTimeout(() => {
      isCopying.value = false;
    }, 1500);
  }
}

function getClipboardDataForQuickCopy(
  item: ClipboardHistoryItem,
): TinyClipboardWrite | null {
  switch (item.kind) {
    case "text":
      return item.text === null
        ? null
        : { text: item.text, html: item.html ?? undefined };
    case "files":
      return item.paths.length ? { paths: item.paths } : null;
    case "image":
      return item.image ? { image: item.image } : null;
    case "color":
      return item.color ? { color: item.color } : null;
  }
}

useHotkeys({ copyItemByNumber: handleQuickCopy });

function scrollActiveCardIntoView(): void {
  if (props.isActive) {
    cardElement.value?.scrollIntoView({ block: "nearest" });
  }
}

onMounted(scrollActiveCardIntoView);
onUnmounted(() => clearTimeout(copyFinishedTimeout));
watch(() => props.isActive, scrollActiveCardIntoView, { flush: "post" });
</script>
<template>
  <div
    ref="cardElement"
    :class="
      cn([
        'hover:bg-foreground/5 cursor-pointer rounded-md p-3 transition-[bg]',
        props.isActive && 'bg-foreground/5',
      ])
    ">
    <div class="flex items-start gap-4">
      <!-- media -->
      <div v-if="previewUrl" class="relative size-9 shrink-0">
        <img
          :src="previewUrl"
          :alt="isImage ? imageName : fileName"
          :class="
            cn([
              'size-full rounded-md',
              isImage ? 'object-cover' : 'object-contain',
            ])
          " />
        <div
          v-if="isCopying"
          class="pointer-events-none absolute inset-0 rounded-md bg-gradient-to-br from-black/65 via-black/40 to-black/20" />
        <Transition v-bind="copyFeedbackTransition">
          <ImageDoneIcon
            v-if="isCopying && isImage"
            class="text-foreground pointer-events-none absolute inset-0 m-auto size-5" />
          <FileVerifiedIcon
            v-else-if="isCopying && isFiles"
            class="text-foreground pointer-events-none absolute inset-0 m-auto size-5" />
        </Transition>
      </div>
      <div v-else :class="cn(['rounded-md p-2', getClipboardThemeClasses()])">
        <Transition v-bind="copyFeedbackTransition" mode="out-in">
          <TickIcon v-if="isCopying" class="text-success size-5" />
          <TextAlignLeftIcon
            v-else-if="itemDetails.kind === 'text'"
            class="size-5" />
          <FileIcon v-else-if="itemDetails.kind === 'files'" class="size-5" />
          <ImageIcon v-else-if="itemDetails.kind === 'image'" class="size-5" />
          <ClipboardIcon v-else class="size-5" />
        </Transition>
      </div>
      <!-- main content -->
      <div class="min-w-0 flex-1 space-y-2">
        <!-- text -->
        <p
          class="font-foreground line-clamp-2 text-sm wrap-break-word"
          v-if="itemDetails.kind === 'text' && itemDetails.text">
          {{ itemDetails.text }}
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
          class="font-foreground flex items-center gap-2 text-sm"
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

        <div class="flex items-center gap-x-2">
          <span
            v-if="sourceAppIconUrl"
            class="text-foreground/50 flex items-center gap-x-1 text-xs">
            <img
              :src="sourceAppIconUrl"
              class="aspect-square size-4 overflow-hidden rounded" />
            {{ itemDetails.sourceApp?.name }}
          </span>
          <template v-if="fileSize">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 text-xs">{{ fileSize }}</span>
          </template>
          <template v-if="itemDetails.dateCopied">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 text-xs">{{ dateCopied }}</span>
          </template>
          <template v-if="isFiles && firstPath">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 min-w-0 flex-1 truncate text-xs">
              {{ firstPath }}</span
            >
          </template>
        </div>
      </div>
      <!-- actions + quick paste -->
      <div class="shrink-0 p-2">
        <div
          class="bg-foreground/1 text-foreground/60 flex w-max items-center gap-0.5 rounded p-1"
          v-if="supportsQuickPaste">
          <CommandIcon />
          <span class="text-xs">{{ quickPasteIndex }}</span>
        </div>
      </div>
    </div>
  </div>
</template>
