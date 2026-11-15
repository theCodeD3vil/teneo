<script setup lang="ts">
defineProps<{
  color: string;
}>();
</script>

<template>
  <div
    class="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 text-center">
    <div
      class="ring-card aspect-square w-[17.5rem] max-w-[75%] shrink-0 rounded-[3.5rem] ring-[10px]"
      :style="{ background: color }" />
    <p class="font-mono text-[1.625rem] leading-[2rem] font-medium select-text">
      {{ color }}
    </p>
  </div>
</template>
