<script setup lang="ts">
import { useQueries } from "@tanstack/vue-query";
import { computed } from "vue";
import TickIcon from "~icons/tabler/check";
import CopyIcon from "~icons/tabler/copy";
import OpenIcon from "~icons/tabler/external-link";
import FileIcon from "~icons/tabler/file";
import FinderIcon from "~icons/tabler/folder-search";

import Button from "@/components/ui/button/Button.vue";
import ScrollArea from "@/components/ui/scroll-area/ScrollArea.vue";
import { Skeleton } from "@/components/ui/skeleton";
import { usePreviewCopy } from "@/composables/usePreviewCopy";
import type { ClipboardHistoryItem, FilePreview } from "@/types/clipboard";
import { getClipboardData, getImageName } from "@/utils/clipboard-items";
import { formatFileSize } from "@/utils/file-size";
import { hidePanel } from "@/utils/panel-reset";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

// Thumbnail bounding boxes in points: one fills the panel, many fill a 4-column grid
const SINGLE_SIZE = 520;
const GRID_SIZE = 120;

const paths = computed(() =>
  props.item.kind === "image"
    ? [props.item.image].filter((path) => path !== null)
    : props.item.paths,
);
const isGrid = computed(() => paths.value.length > 1);

const previews = useQueries({
  queries: computed(() =>
    paths.value.map((path) => {
      const size = isGrid.value ? GRID_SIZE : SINGLE_SIZE;
      return {
        queryKey: ["file-preview", path, size],
        queryFn: (): Promise<FilePreview> =>
          tiny.api.call("filePreview", { path, size }),
        refetchOnWindowFocus: false,
      };
    }),
  ),
});

const files = computed(() =>
  paths.value.map((path, index) => {
    const preview = previews.value[index];
    return {
      path,
      name: path.split("/").pop() ?? path,
      url: preview?.data?.url ?? null,
      isLoading: preview?.isPending ?? true,
      isMissing: preview?.data?.isMissing ?? false,
    };
  }),
);
const availablePaths = computed(() =>
  files.value.filter((file) => !file.isMissing).map((file) => file.path),
);

const single = computed(() => files.value[0]);
const title = computed(() =>
  props.item.kind === "image" ? getImageName(props.item) : single.value?.name,
);
const details = computed(() => {
  const { imageSize, fileSize, kind } = props.item;
  if (kind === "image") {
    return imageSize ? `${imageSize.width} × ${imageSize.height}` : null;
  }
  const folder = single.value?.path.split("/").slice(0, -1).join("/");
  return [fileSize == null ? null : formatFileSize(fileSize), folder]
    .filter(Boolean)
    .join(" · ");
});

const { isCopied, copy } = usePreviewCopy(() =>
  availablePaths.value.length ? getClipboardData(props.item) : null,
);

// Opening hands the user to another app, so the panel gets out of the way
async function openFiles(): Promise<void> {
  await Promise.all(
    availablePaths.value.map((path) => tiny.app.shell.open(path)),
  );
  await hidePanel();
}

async function showInFinder(): Promise<void> {
  const [path] = availablePaths.value;
  if (!path) return;
  await tiny.app.shell.reveal(path);
  await hidePanel();
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center gap-4">
    <ScrollArea v-if="isGrid" class="min-h-0 w-full flex-1">
      <div class="grid grid-cols-4 gap-3">
        <div
          v-for="file in files"
          :key="file.path"
          :title="file.path"
          :class="[
            'flex min-w-0 flex-col gap-1.5',
            file.isMissing && 'opacity-50',
          ]">
          <div
            class="bg-foreground/5 flex aspect-square items-center justify-center overflow-hidden rounded-md p-2">
            <Skeleton v-if="file.isLoading" class="size-full" />
            <img
              v-else-if="file.url"
              :src="file.url"
              alt=""
              class="max-h-full max-w-full object-contain" />
            <FileIcon v-else class="text-foreground/30 size-8" />
          </div>
          <span
            :class="[
              'truncate text-center text-xs',
              file.isMissing && 'line-through',
            ]">
            {{ file.name }}
          </span>
        </div>
      </div>
    </ScrollArea>

    <template v-else-if="single">
      <div class="flex min-h-0 w-full flex-1 items-center justify-center">
        <Skeleton
          v-if="single.isLoading"
          class="aspect-square h-full max-h-80" />
        <img
          v-else-if="single.url"
          :src="single.url"
          alt=""
          class="max-h-full max-w-full rounded-md object-contain" />
        <div
          v-else
          class="text-foreground/40 flex flex-col items-center gap-2 text-sm">
          <FileIcon class="size-12" />
          <span v-if="single.isMissing">No longer available</span>
        </div>
      </div>
      <div class="flex max-w-full flex-col items-center gap-0.5 text-center">
        <span
          :class="[
            'max-w-full truncate text-sm',
            single.isMissing && 'text-foreground/50 line-through',
          ]">
          {{ title }}
        </span>
        <span
          v-if="details"
          class="text-foreground/50 max-w-full truncate text-xs"
          :title="details">
          {{ details }}
        </span>
      </div>
    </template>

    <div class="flex items-center gap-2">
      <Button
        variant="secondary"
        :disabled="!availablePaths.length"
        @click="openFiles">
        <OpenIcon />
        Open
      </Button>
      <Button
        v-if="item.kind === 'files'"
        variant="secondary"
        :disabled="!availablePaths.length"
        @click="showInFinder">
        <FinderIcon />
        Show in Finder
      </Button>
      <Button
        variant="secondary"
        :disabled="!availablePaths.length"
        @click="copy(false)">
        <TickIcon v-if="isCopied" class="text-success" />
        <CopyIcon v-else />
        {{ isCopied ? "Copied" : "Copy" }}
      </Button>
    </div>
  </div>
</template>
