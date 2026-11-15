<script lang="ts" setup>
import LinkIcon from "~icons/tabler/arrow-up-right";

const props = defineProps<{ name: string; url: string }>();

// Capacitor hands links to other sites to the phone's browser
function openLink(): void {
  window.open(props.url, "_blank");
}
</script>

<template>
  <button
    type="button"
    class="bg-tint-blue text-tint-blue-ink flex h-[2.75rem] items-center gap-1.5 rounded-full pr-[0.875rem] pl-[1.125rem] text-[0.9375rem] font-semibold transition-transform active:scale-[0.97]"
    :aria-label="`Open ${url}`"
    @click="openLink">
    {{ name }}
    <LinkIcon class="size-[1.125rem]" />
  </button>
</template>
