<script setup lang="ts">
defineProps<{
  color: string;
}>();
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
    <div
      class="ring-foreground/10 aspect-[1.91/1] w-72 shrink-0 rounded-md ring-1"
      :style="{ background: color }" />
    <p class="font-mono text-sm font-semibold select-text">{{ color }}</p>
  </div>
</template>
