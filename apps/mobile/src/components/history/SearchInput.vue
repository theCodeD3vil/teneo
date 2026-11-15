<script setup lang="ts">
import { nextTick, ref } from "vue";
import SearchIcon from "~icons/tabler/search";
import ClearIcon from "~icons/tabler/x";

/** The search button at the end of the header. A tap widens it into the
 *  search field, over the title; it closes again once it is empty and the
 *  keyboard is gone. */
const input = ref<HTMLInputElement | null>(null);
const searchQuery = defineModel<string>({ default: "" });
const isOpen = defineModel<boolean>("open", { default: false });

function open(): void {
  isOpen.value = true;
  void nextTick(() => input.value?.focus());
}

function close(): void {
  searchQuery.value = "";
  isOpen.value = false;
  input.value?.blur();
}

function closeIfEmpty(): void {
  if (!searchQuery.value) isOpen.value = false;
}

function blur(): void {
  input.value?.blur();
}

defineExpose({ blur });
</script>

<template>
  <div
    class="bg-card absolute top-1 right-2 flex h-[3rem] items-center overflow-hidden rounded-full border transition-[width,border-color] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
    :class="
      isOpen
        ? 'border-primary w-[calc(100%-1rem)]'
        : 'w-[3rem] border-transparent'
    ">
    <button
      type="button"
      aria-label="Search clipboard"
      class="grid size-[2.875rem] shrink-0 place-items-center"
      @click="open">
      <SearchIcon class="size-[1.375rem]" />
    </button>
    <input
      v-show="isOpen"
      ref="input"
      v-model="searchQuery"
      type="search"
      enterkeyhint="search"
      placeholder="Search clipboard"
      class="placeholder:text-muted-foreground h-full min-w-0 flex-1 bg-transparent text-sm outline-none [&::-webkit-search-cancel-button]:hidden"
      @keydown.enter="blur"
      @blur="closeIfEmpty" />
    <!-- a phone keyboard has no Esc to clear the field -->
    <button
      v-show="isOpen"
      type="button"
      aria-label="Clear search"
      class="text-muted-foreground grid size-[2.875rem] shrink-0 place-items-center"
      @pointerdown.prevent
      @click="close">
      <ClearIcon class="size-[1.25rem]" />
    </button>
  </div>
</template>
