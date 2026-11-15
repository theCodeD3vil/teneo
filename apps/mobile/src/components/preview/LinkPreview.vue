<script setup lang="ts">
import type { LinkPreviewImage } from "@teneo/shared/types/clipboard";
import { Skeleton } from "@teneo/ui/components/skeleton";
import { ref, watch } from "vue";
import OpenIcon from "~icons/tabler/arrow-up-right";
import LinkIcon from "~icons/tabler/link";

import { useClient } from "../../client";
import { useSettings } from "../../composables/useSettings";

const props = defineProps<{
  url: string;
}>();

const client = useClient();
const { settings } = useSettings();

// Fetched from the site itself and kept on the phone, like the cards' icons
const preview = ref<LinkPreviewImage | null>(null);
const isLoading = ref(false);
watch(
  () => [props.url, settings.value.showLinkPreviews] as const,
  ([url, isShown]) => {
    preview.value = null;
    isLoading.value = isShown;
    if (!isShown) return;
    void client
      .getLinkPreviewImage(url)
      .catch(() => null) // not reached: the link icon shows
      .then((image) => {
        if (url !== props.url) return; // another link is shown by now
        preview.value = image;
        isLoading.value = false;
      });
  },
  { immediate: true },
);

// Capacitor hands links to other sites to the phone's browser
function openInBrowser(): void {
  window.open(props.url, "_blank");
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 text-center">
    <!-- 1.91:1 is the shape sites make their share images in -->
    <div
      class="bg-tint-violet flex aspect-[1.91/1] w-full shrink-0 items-center justify-center overflow-hidden rounded-[2rem]">
      <Skeleton v-if="isLoading" class="size-full" />
      <img
        v-else-if="preview && preview.source !== 'icon'"
        :src="preview.image"
        alt=""
        class="size-full object-cover" />
      <!-- an icon is small: shown as is rather than stretched to fill -->
      <img
        v-else-if="preview"
        :src="preview.image"
        alt=""
        class="size-12 rounded-xl" />
      <LinkIcon v-else class="text-tint-violet-ink size-8" />
    </div>

    <p
      class="min-h-0 max-w-[20rem] overflow-y-auto text-sm leading-[1.625rem] break-all select-text">
      {{ url }}
    </p>
    <button
      type="button"
      class="pill-button h-[3.25rem] gap-[0.625rem] border-transparent px-6 text-[1rem]"
      @click="openInBrowser">
      <OpenIcon />
      Open in browser
    </button>
  </div>
</template>
