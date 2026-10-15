<script lang="ts" setup>
import { Icon } from "@iconify/vue";

import { cn } from "@/lib/utils";
const props = defineProps<{
  itemDetails: TinyClipboardData;
}>();
function getClipboardIcon() {
  switch (props.itemDetails.kind) {
    case "text":
      return "hugeicons:text-align-left";
    case "files":
      return "hugeicons:file-01";
    case "image":
      return "hugeicons:image-01";
    default:
      return "hugeicons:clipboard";
  }
}
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
const previewUrl = previewPath
  ? await tiny.api.call("filePreview", { path: previewPath })
  : null;
const isPreviewMissing = (isImage || isFiles) && !previewUrl;
const fileName = firstPath?.split("/").pop();
const otherFileCount = props.itemDetails.paths.length - 1;

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
</script>
<template>
  <div
    class="hover:bg-foreground/5 cursor-pointer rounded-md p-3 transition-[bg]">
    <div class="flex items-center gap-4">
      <img
        v-if="previewUrl"
        :src="previewUrl"
        :alt="isImage ? imageName : fileName"
        :class="
          cn([
            'size-9 shrink-0 rounded-md',
            isImage ? 'object-cover' : 'object-contain',
          ])
        " />
      <div v-else :class="cn(['rounded-md p-2', getClipboardThemeClasses()])">
        <Icon width="20" height="20" :icon="getClipboardIcon()" />
      </div>
      <div class="flex-1 space-y-2">
        <p
          class="font-foreground max-w-[70%] truncate text-sm"
          v-if="itemDetails.text">
          {{ itemDetails.text }}
        </p>
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

        <div class="flex gap-x-1">
          <span
            v-if="sourceAppIconUrl"
            class="text-foreground/50 flex items-center gap-x-1 text-xs">
            <img
              :src="sourceAppIconUrl"
              class="aspect-square size-4 overflow-hidden rounded" />
            {{ itemDetails.sourceApp?.name }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
