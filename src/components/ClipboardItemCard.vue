<script lang="ts" setup>
import { useQuery } from "@tanstack/vue-query";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import ClipboardIcon from "~icons/hugeicons/clipboard";
import CommandIcon from "~icons/hugeicons/command";
import DeleteIcon from "~icons/hugeicons/delete-02";
import FileIcon from "~icons/hugeicons/file-01";
import FileVerifiedIcon from "~icons/hugeicons/file-verified";
import ImageIcon from "~icons/hugeicons/image-01";
import ImageDoneIcon from "~icons/hugeicons/image-done-01";
import LinkIcon from "~icons/hugeicons/link-01";
import PinIcon from "~icons/hugeicons/pin";
import PinOffIcon from "~icons/hugeicons/pin-off";
import TextAlignLeftIcon from "~icons/hugeicons/text-align-left";
import TickIcon from "~icons/hugeicons/tick-02";

import BetaBadge from "@/components/BetaBadge.vue";
import Button from "@/components/ui/button/Button.vue";
import { useHotkeys } from "@/composables/useHotkeys";
import { useRelativeTimeAgo } from "@/composables/useRelativeTimeAgo";
import { useSettings } from "@/composables/useSettings";
import type { QuickCopyItemNumber } from "@/constants/hotkeys";
import { cn } from "@/lib/utils";
import type { ClipboardHistoryItem } from "@/types/clipboard";
import { formatFileSize } from "@/utils/file-size";
import { maskSecrets } from "@/utils/secrets";

const props = defineProps<{
  itemDetails: ClipboardHistoryItem;
  isActive?: boolean;
  supportsQuickPaste?: boolean;
  quickPasteIndex?: number;
}>();

defineExpose({
  copyAndHideWindow,
  pasteAndHideWindow,
  previewItem,
  deleteItem,
  pinItem,
});

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

// The app icon and preview load after the card shows, so a card never waits on
// the backend; they're cached, so a card seen before shows them at once.
const sourceAppBundleId = props.itemDetails.sourceApp?.bundleId;
// data: URL of the app's icon, or null when the app can't be found
const { data: sourceAppIconUrl } = useQuery({
  queryKey: ["app-icon", sourceAppBundleId],
  queryFn: (): Promise<string | null> =>
    tiny.api.call("appIcon", { bundleId: sourceAppBundleId }),
  enabled: Boolean(sourceAppBundleId),
  // an app's icon doesn't change while Teneo runs
  staleTime: Infinity,
  gcTime: Infinity,
});

// Images and files are previewed from disk: the saved image copy, or the first copied file.
// The preview is a data: URL, or null when that file was moved or deleted since
// it was copied; until it loads, the kind icon holds its place at the same size.
const isImage = props.itemDetails.kind === "image";
const isFiles = props.itemDetails.kind === "files";
const firstPath = props.itemDetails.paths[0];

const previewPath = isImage
  ? props.itemDetails.image
  : isFiles
    ? firstPath
    : null;

const { data: previewUrl } = useQuery({
  queryKey: ["file-preview", previewPath],
  queryFn: (): Promise<string | null> =>
    tiny.api.call("filePreview", { path: previewPath }),
  enabled: Boolean(previewPath),
  // the panel only hides, so this would redo every preview each time it opens
  refetchOnWindowFocus: false,
});

// A link shows its site's icon, fetched by the backend from the site itself.
// Until it loads, or when previews are off, the link icon holds its place.
const link = props.itemDetails.link;
const { settings } = useSettings();
const { data: linkPreviewUrl } = useQuery({
  queryKey: ["link-preview", link?.url],
  queryFn: (): Promise<string | null> =>
    tiny.api.call("linkPreview", { url: link?.url }),
  enabled: computed(() => Boolean(link) && settings.value.showLinkPreviews),
  // saved on disk by the backend; a site that couldn't be reached is asked
  // again when the card next mounts, not retried in a loop
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: false,
});

const mediaUrl = computed(
  () =>
    previewUrl.value ??
    (settings.value.showLinkPreviews ? linkPreviewUrl.value : null),
);

const isPreviewMissing = computed(
  () => (isImage || isFiles) && (!previewPath || previewUrl.value === null),
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
const textParts = computed(() => {
  const text = props.itemDetails.text ?? "";
  return settings.value.maskSecrets
    ? maskSecrets(text, props.itemDetails.secrets)
    : [{ text }];
});
const secretLabels = computed(() =>
  [
    ...new Set(textParts.value.map((part) => part.secretLabel).filter(Boolean)),
  ].join(", "),
);

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
    isPreviewMissing.value
  ) {
    return false;
  }

  return copyItem(true);
}

function copyAndHideWindow(): boolean {
  return copyItem(true);
}

function pasteAndHideWindow(): boolean {
  return copyItem(true, true);
}

/** Quick Look the copied file(s) or image; text and colors have no file to show. */
function previewItem(): boolean {
  if (isPreviewMissing.value || !previewPath) return false;

  void tiny.macos
    .quickLook(isFiles ? props.itemDetails.paths : [previewPath])
    .catch(() => undefined);
  return true;
}

function copyItem(hideWindow = false, paste = false): boolean {
  if (isPreviewMissing.value || isCopying.value) return false;

  const clipboardData = getClipboardDataForQuickCopy(props.itemDetails);
  if (!clipboardData) return false;

  void copyToClipboard(clipboardData, hideWindow, paste).catch(() => undefined);
  return true;
}

// Posting ⌘V needs the Accessibility permission; ask for it when it is missing.
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

async function pasteIntoFrontmostApp(): Promise<void> {
  const { trusted } = await tiny.app.paste();
  if (!trusted) await tiny.app.permissions.request("accessibility");
}

async function copyToClipboard(
  clipboardData: TinyClipboardWrite,
  hideWindow: boolean,
  paste: boolean,
): Promise<void> {
  isCopying.value = true;

  try {
    await tiny.clipboard.write(clipboardData);
    if (hideWindow) await tiny.api.call("hidePanel");
    // after the hide, focus is back in the app the user was typing in
    if (paste) await pasteIntoFrontmostApp();
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
      if (!item.image) return null;
      return item.pasteAsFile ? { paths: [item.image] } : { image: item.image };
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
    :data-active="isActive || undefined"
    @click="copyItem()"
    :class="
      cn([
        'group/card hover:bg-foreground/5 cursor-pointer rounded-md p-3 transition-[bg]',
        props.isActive && 'bg-foreground/5',
      ])
    ">
    <div class="flex items-start gap-4">
      <!-- media -->
      <div v-if="mediaUrl" class="relative size-9 shrink-0">
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
          <TickIcon
            v-else-if="isCopying"
            class="text-success pointer-events-none absolute inset-0 m-auto size-5" />
        </Transition>
      </div>
      <div v-else :class="cn(['rounded-md p-2', getClipboardThemeClasses()])">
        <Transition v-bind="copyFeedbackTransition" mode="out-in">
          <TickIcon v-if="isCopying" class="text-success size-5" />
          <LinkIcon v-else-if="link" class="size-5" />
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
          <template v-if="link">
            <span class="text-foreground/50">·</span>
            <span class="text-foreground/50 truncate text-xs">{{
              link.host
            }}</span>
          </template>
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
            class="text-foreground/60 hover:text-foreground hover:bg-foreground/10!"
            @click.stop="pinItem">
            <PinOffIcon v-if="itemDetails.pinned" />
            <PinIcon v-else />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            title="Delete"
            class="text-foreground/60 hover:text-destructive hover:bg-destructive/10!"
            @click.stop="deleteItem">
            <DeleteIcon />
          </Button>
        </div>
      </div>
    </div>
  </div>
</template>
