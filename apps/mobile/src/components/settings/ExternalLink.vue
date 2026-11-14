<script lang="ts" setup>
import { Button } from "@teneo/ui/components/button";
import LinkIcon from "~icons/tabler/external-link";

const props = defineProps<{ name: string; url: string }>();

// Capacitor hands links to other sites to the phone's browser
function openLink(): void {
  window.open(props.url, "_blank");
}
</script>

<template>
  <span class="text-foreground/60 flex items-center gap-1 text-sm">
    {{ name }}
    <Button
      variant="ghost"
      size="icon-sm"
      :aria-label="`Open ${url}`"
      @click="openLink">
      <LinkIcon />
    </Button>
  </span>
</template>
