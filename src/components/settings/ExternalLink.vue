<script lang="ts" setup>
import LinkIcon from "~icons/hugeicons/link-square-02";

import { Button } from "@/components/ui/button";

const props = defineProps<{ name: string; url: string }>();

// Opens in the default browser; the settings window can't navigate away
function openLink(): void {
  void tiny.app.shell.open(props.url);
}
</script>

<template>
  <span class="text-foreground/60 flex items-center gap-1 text-sm">
    {{ name }}
    <Button
      variant="ghost"
      size="icon-xs"
      :aria-label="`Open ${url}`"
      :title="url"
      @click="openLink">
      <LinkIcon />
    </Button>
  </span>
</template>
