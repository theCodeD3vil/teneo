<script lang="ts" setup>
import { Icon } from "@iconify/vue";

import { AspectRatio } from "@/components/ui/aspect-ratio";
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

// Files: preview the first path; null means the file was moved or deleted since it was copied
const isFiles = props.itemDetails.kind === "files";
const firstPath = props.itemDetails.paths[0];
const filePreviewUrl = isFiles
  ? await tiny.api.call("filePreview", { path: firstPath })
  : null;
const isFileMissing = isFiles && !filePreviewUrl;
const fileName = firstPath?.split("/").pop();
const otherFileCount = props.itemDetails.paths.length - 1;
</script>
<template>
  <div
    class="hover:bg-foreground/5 cursor-pointer rounded-md p-3 transition-[bg]">
    <div class="flex items-center gap-4">
      <div v-if="itemDetails.image">
        <!-- <AspectRatio :ratio="1 / 1"> -->
        <img
          :src="itemDetails.image"
          alt="Image"
          class="size-9 rounded-md object-cover" />
        <!-- </AspectRatio> -->
      </div>
      <img
        v-else-if="filePreviewUrl"
        :src="filePreviewUrl"
        :alt="fileName"
        class="size-9 shrink-0 rounded-md object-contain" />
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
                isFileMissing && 'text-foreground/50 line-through',
              ])
            ">
            {{ fileName }}
          </span>
          <span v-if="otherFileCount > 0" class="text-foreground/50 text-xs"
            >+{{ otherFileCount }}</span
          >
          <span v-if="isFileMissing" class="text-foreground/50 text-xs"
            >File no longer exists</span
          >
        </p>

        <p
          class="font-foreground max-w-[70%] truncate text-sm"
          v-if="itemDetails.image">
          {{ itemDetails.text }}
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
