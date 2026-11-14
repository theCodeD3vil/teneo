<script setup lang="ts">
import Button from "@teneo/ui/components/button/Button.vue";
import OpenIcon from "~icons/tabler/external-link";
import LinkIcon from "~icons/tabler/link";

const props = defineProps<{
  url: string;
}>();

// Capacitor hands links to other sites to the phone's browser
function openInBrowser(): void {
  window.open(props.url, "_blank");
}
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
    <!-- 1.91:1 is the shape sites make their share images in -->
    <div
      class="bg-foreground/5 flex aspect-[1.91/1] w-72 shrink-0 items-center justify-center overflow-hidden rounded-md">
      <LinkIcon class="text-foreground/30 size-8" />
    </div>

    <p class="min-h-0 max-w-sm overflow-y-auto text-sm break-all select-text">
      {{ url }}
    </p>
    <Button variant="secondary" @click="openInBrowser">
      <OpenIcon />
      Open in browser
    </Button>
  </div>
</template>
