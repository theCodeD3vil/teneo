<script lang="ts" setup>
import { shortTimeAgo } from "@teneo/shared/time/ago";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { currentTime } from "@teneo/ui/composables/useRelativeTimeAgo";
import { cn } from "@teneo/ui/lib/utils";
import { makerIcon } from "@teneo/ui/utils/device-makers";
import { formatFileSize } from "@teneo/ui/utils/file-size";
import { maskSecrets, type TextPart } from "@teneo/ui/utils/secrets";
import { computed, onUnmounted, ref } from "vue";
import TextAlignLeftIcon from "~icons/tabler/align-left";
import OpenIcon from "~icons/tabler/arrow-up-right";
import ClipboardIcon from "~icons/tabler/clipboard";
import FileIcon from "~icons/tabler/file";
import KeyIcon from "~icons/tabler/key";
import LinkIcon from "~icons/tabler/link";
import ImageIcon from "~icons/tabler/photo";

import { useClient } from "../../client";
import { useAppIcons } from "../../composables/useAppIcons";
import { showCopiedNotice } from "../../composables/useCopiedNotice";
import { useLinkPreviews } from "../../composables/useLinkPreviews";
import { useSettings } from "../../composables/useSettings";
import BetaBadge from "../BetaBadge.vue";

const props = defineProps<{
  itemDetails: ClipboardHistoryItem;
  /** its menu is open */
  isActive?: boolean;
  /** a row in the list, or a square tile on the pinned shelf */
  layout?: "row" | "tile";
}>();

const emit = defineEmits<{
  (e: "preview", item: ClipboardHistoryItem): void;
}>();

const client = useClient();
const { settings } = useSettings();
// A link shows its site's icon, fetched from the site itself. Until it
// loads, or when previews are off, the link icon holds its place.
const { linkIcon } = useLinkPreviews();
const siteIcon = computed(() => linkIcon(props.itemDetails));
// An item copied on a Mac shows the icon of the app it came from, which sync
// fetched from the Mac and the phone keeps by the app's name
const { appIcon } = useAppIcons();
const sourceAppIcon = computed(() =>
  appIcon(props.itemDetails.sourceApp?.name),
);
// An item copied on a phone is named after the phone, with its maker's logo
const deviceMakerIcon = computed(() =>
  makerIcon(props.itemDetails.originMaker),
);

const isCopying = ref(false);
// Bumped on each copy so the sweep across the card plays again
const shimmerKey = ref(0);
let copyFinishedTimeout: ReturnType<typeof setTimeout> | undefined;

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

// a copy made again moves the item's time, so it is read from the item each time
const dateCopied = computed(() =>
  shortTimeAgo(props.itemDetails.dateCopied, currentTime.value.getTime()),
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

// Each kind of item has its own tint: on the icon tile of a row, and across
// the whole of a pinned tile
const tints = {
  blue: {
    tile: "bg-tint-blue text-tint-blue-ink",
    surface: "bg-tint-blue",
    ink: "text-tint-blue-ink",
    sub: "text-tint-blue-sub",
  },
  violet: {
    tile: "bg-tint-violet text-tint-violet-ink",
    surface: "bg-tint-violet",
    ink: "text-tint-violet-ink",
    sub: "text-tint-violet-sub",
  },
  peach: {
    tile: "bg-tint-peach text-tint-peach-ink",
    surface: "bg-tint-peach",
    ink: "text-tint-peach-ink",
    sub: "text-tint-peach-sub",
  },
  mint: {
    tile: "bg-tint-mint text-tint-mint-ink",
    surface: "bg-tint-mint",
    ink: "text-tint-mint-ink",
    sub: "text-tint-mint-sub",
  },
  amber: {
    tile: "bg-tint-amber text-tint-amber-ink",
    surface: "bg-tint-amber",
    ink: "text-tint-amber-ink",
    sub: "text-tint-amber-sub",
  },
  neutral: {
    tile: "bg-tint-neutral text-tint-neutral-ink",
    surface: "bg-tint-neutral",
    ink: "text-tint-neutral-ink",
    sub: "text-tint-neutral-sub",
  },
};
const tint = computed(() => {
  if (props.itemDetails.color) return tints.mint;
  if (isImage.value) return tints.peach;
  if (isFiles.value) return tints.neutral;
  if (props.itemDetails.link) return tints.violet;
  if (secretLabels.value) return tints.amber;
  return tints.blue;
});

// a pinned image is its tile's background
const hasImageBackground = computed(
  () => isImage.value && Boolean(props.itemDetails.image),
);

// what a pinned tile says in its two lines
const tileTitle = computed(() => {
  if (props.itemDetails.color) return props.itemDetails.color;
  if (isFiles.value) return fileName.value;
  if (isImage.value) return imageName.value;
  return textParts.value.map((part) => part.text).join("");
});

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
  <!-- a pinned item: a tile in its kind's tint. Its slot on the shelf gives
       it its size. -->
  <div
    v-if="props.layout === 'tile'"
    :data-item-id="itemDetails.id"
    :data-active="isActive || undefined"
    :class="
      cn([
        'shelf-tile relative flex size-full shrink-0 cursor-pointer flex-col justify-between overflow-hidden rounded-[1.75rem] transition-transform active:scale-[0.97]',
        hasImageBackground ? 'p-2' : 'p-4',
        tint.surface,
        props.isActive && 'ring-primary ring-2 ring-inset',
      ])
    "
    @click="copyItem">
    <!-- an image fills its tile; its text sits on frosted glass over it -->
    <img
      v-if="hasImageBackground"
      :src="itemDetails.image ?? undefined"
      :alt="imageName"
      loading="lazy"
      class="absolute inset-0 size-full object-cover" />
    <img
      v-else-if="siteIcon"
      :src="siteIcon"
      :alt="itemDetails.link?.host"
      class="size-[2.25rem] rounded-[0.75rem] object-cover" />
    <span
      v-else-if="itemDetails.color"
      class="border-card size-[2.25rem] rounded-[0.75rem] border-[3px]"
      :style="{ background: itemDetails.color }" />
    <span
      v-else
      :class="
        cn([
          'bg-card grid size-[2.25rem] place-items-center rounded-[0.75rem]',
          tint.ink,
        ])
      ">
      <LinkIcon v-if="itemDetails.link" class="size-[1.25rem]" />
      <KeyIcon v-else-if="secretLabels" class="size-[1.25rem]" />
      <TextAlignLeftIcon
        v-else-if="itemDetails.kind === 'text'"
        class="size-[1.25rem]" />
      <FileIcon v-else-if="isFiles" class="size-[1.25rem]" />
      <ImageIcon v-else-if="isImage" class="size-[1.25rem]" />
      <ClipboardIcon v-else class="size-[1.25rem]" />
    </span>
    <div
      :class="
        cn([
          'flex min-w-0 flex-col gap-1',
          hasImageBackground &&
            'relative mt-auto rounded-[1.25rem] bg-white/60 px-3 py-2 backdrop-blur-md dark:bg-black/50',
        ])
      ">
      <p
        :class="
          cn([
            'line-clamp-2 text-[0.9375rem] leading-[1.25rem] font-semibold wrap-break-word',
            (itemDetails.color || secretLabels) && 'font-mono font-medium',
          ])
        ">
        {{ tileTitle }}
      </p>
      <span
        :class="
          cn([
            'truncate text-[0.8125rem] leading-[1.125rem]',
            hasImageBackground ? 'text-foreground/80' : tint.sub,
          ])
        ">
        {{ itemDetails.sourceApp?.name ?? dateCopied }}
      </span>
    </div>
    <div
      v-if="shimmerKey"
      :key="shimmerKey"
      class="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
      <div
        class="animate-copy-shimmer absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent via-white/50 to-transparent"
        @animationend="shimmerKey = 0" />
    </div>
  </div>

  <div
    v-else
    :data-item-id="itemDetails.id"
    :data-active="isActive || undefined"
    :class="
      cn([
        'group/card bg-card relative flex cursor-pointer items-center gap-[0.875rem] rounded-[1.5rem] py-[0.875rem] pr-3 pl-[0.875rem] transition-transform active:scale-[0.985]',
        props.isActive && 'ring-primary ring-2 ring-inset',
      ])
    "
    @click="copyItem">
    <!-- a link's icon fills the square like an app icon -->
    <!-- an image shows itself, small -->
    <img
      v-if="isImage && itemDetails.image"
      :src="itemDetails.image"
      :alt="imageName"
      loading="lazy"
      class="size-[2.75rem] shrink-0 rounded-[0.875rem] object-cover" />
    <img
      v-else-if="siteIcon"
      :src="siteIcon"
      :alt="itemDetails.link?.host"
      class="size-[2.75rem] shrink-0 rounded-[0.875rem] object-cover" />
    <!-- a colour is its own icon -->
    <span
      v-else-if="itemDetails.color"
      class="border-tint-mint size-[2.75rem] shrink-0 rounded-[0.875rem] border-4"
      :style="{ background: itemDetails.color }" />
    <div
      v-else
      :class="
        cn([
          'grid size-[2.75rem] shrink-0 place-items-center rounded-[0.875rem]',
          tint.tile,
        ])
      ">
      <LinkIcon v-if="itemDetails.link" class="size-[1.375rem]" />
      <KeyIcon v-else-if="secretLabels" class="size-[1.375rem]" />
      <TextAlignLeftIcon
        v-else-if="itemDetails.kind === 'text'"
        class="size-[1.375rem]" />
      <FileIcon v-else-if="isFiles" class="size-[1.375rem]" />
      <ImageIcon v-else-if="isImage" class="size-[1.375rem]" />
      <ClipboardIcon v-else class="size-[1.375rem]" />
    </div>
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <!-- text -->
      <p
        v-if="itemDetails.kind === 'text' && itemDetails.text"
        class="line-clamp-2 text-[1rem] leading-[1.375rem] wrap-break-word">
        <template v-for="(part, index) in textParts" :key="index">
          <!-- a masked key and its badge wrap as one -->
          <span v-if="part.secretLabel" class="whitespace-nowrap">
            <span class="font-mono">{{ part.text }}</span>
            <BetaBadge class="ml-1" />
          </span>
          <template v-else>{{ part.text }}</template>
        </template>
      </p>
      <!-- color: its value; the icon is the preview -->
      <p
        v-if="itemDetails.color"
        class="font-mono text-[1rem] leading-[1.375rem] font-medium">
        {{ itemDetails.color }}
      </p>
      <!-- file -->
      <p
        v-if="isFiles"
        class="flex items-center gap-2 text-[1rem] leading-[1.375rem] whitespace-nowrap">
        <span class="truncate">{{ fileName }}</span>
        <span
          v-if="otherFileCount > 0"
          class="text-muted-foreground text-[0.8125rem]"
          >+{{ otherFileCount }}</span
        >
      </p>
      <!-- image -->
      <p v-if="isImage" class="truncate text-[1rem] leading-[1.375rem]">
        {{ imageName }}
      </p>

      <!-- one line: where it came from, size, date, secrets -->
      <div
        class="text-muted-foreground flex items-center gap-x-2 text-[0.8125rem] leading-[1.125rem] whitespace-nowrap">
        <!-- beside the name, not around it: the name truncates on its own -->
        <img
          v-if="itemDetails.sourceApp && sourceAppIcon"
          :src="sourceAppIcon"
          alt=""
          class="-mr-1 size-4 shrink-0 rounded" />
        <component
          :is="deviceMakerIcon"
          v-else-if="itemDetails.sourceApp && deviceMakerIcon"
          class="-mr-1 size-3 shrink-0" />
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
    <button
      type="button"
      aria-label="Open"
      class="bg-well text-foreground active:bg-muted grid size-[2.75rem] shrink-0 place-items-center rounded-full transition-colors"
      @click.stop="emit('preview', itemDetails)">
      <OpenIcon class="size-[1.25rem]" />
    </button>
    <!-- a light sweeps across the card just copied, so it's clear which one -->
    <div
      v-if="shimmerKey"
      :key="shimmerKey"
      class="pointer-events-none absolute inset-0 overflow-hidden rounded-[1.5rem] motion-reduce:hidden">
      <div
        class="animate-copy-shimmer via-success/20 absolute inset-y-0 left-0 w-1/2 -skew-x-12 bg-gradient-to-r from-transparent to-transparent"
        @animationend="shimmerKey = 0" />
    </div>
  </div>
</template>
