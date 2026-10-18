<script setup lang="ts">
import SettingsTabManager from "@/components/settings/SettingsTabManager.vue";
</script>

<template>
  <div class="flex h-screen flex-col overflow-hidden bg-transparent! px-4 pb-4">
    <!-- the window is frameless: the top strip and logo row drag the window -->
    <header data-tiny-drag class="h-3 shrink-0" />
    <div
      data-tiny-drag
      class="mb-8 flex w-full items-center justify-center gap-x-2">
      <img class="aspect-square size-8" src="/icon.png" alt="Teneo Icon" />
      <span class="text-lg font-medium">Teneo</span>
    </div>
    <SettingsTabManager />
  </div>
</template>
