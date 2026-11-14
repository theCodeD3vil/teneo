<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { computed } from "vue";
import OpenIcon from "~icons/tabler/external-link";
import LinkIcon from "~icons/tabler/link";

import Button from "@/components/ui/button/Button.vue";
import { Skeleton } from "@/components/ui/skeleton";
import { useSettings } from "@/composables/useSettings";
import type { LinkPreviewImage } from "@/types/clipboard";
import { hidePanel } from "@/utils/panel-reset";

const props = defineProps<{
  url: string;
}>();

const { settings } = useSettings();
const url = computed(() => props.url);

// Fetched by the backend from the site itself and saved on disk, like card icons
const { data: preview, isPending } = useQuery({
  queryKey: computed(() => ["link-preview-image", url.value]),
  queryFn: (): Promise<LinkPreviewImage | null> =>
    tiny.api.call("linkPreviewImage", { url: url.value }),
  enabled: computed(() => settings.value.showLinkPreviews),
  staleTime: Infinity,
  refetchOnWindowFocus: false,
  retry: false,
});
const isLoading = computed(
  () => settings.value.showLinkPreviews && isPending.value,
);

// The browser takes focus, so the panel gets out of the way
async function openInBrowser(): Promise<void> {
  await tiny.app.shell.open(url.value);
  await hidePanel();
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
    <!-- 1.91:1 is the shape sites make their share images in -->
    <div
      class="bg-foreground/5 flex aspect-[1.91/1] w-72 shrink-0 items-center justify-center overflow-hidden rounded-md">
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
      <LinkIcon v-else class="text-foreground/30 size-8" />
    </div>

    <p class="min-h-0 max-w-sm overflow-y-auto text-sm break-all">
      {{ url }}
    </p>
    <Button variant="secondary" @click="openInBrowser">
      <OpenIcon />
      Open in browser
    </Button>
  </div>
</template>
