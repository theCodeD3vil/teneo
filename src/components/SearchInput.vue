<script setup lang="ts">
import { ref } from "vue";
import SearchIcon from "~icons/tabler/search";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

const searchInputContainer = ref<HTMLElement | null>(null);
const searchQuery = defineModel<string>({ default: "" });

function focus(): void {
  searchInputContainer.value?.querySelector("input")?.focus();
}

function blur(): void {
  searchInputContainer.value?.querySelector("input")?.blur();
}

defineExpose({ focus, blur });
</script>

<template>
  <div ref="searchInputContainer" class="w-full gap-6">
    <InputGroup variant="transparent">
      <InputGroupInput
        v-model="searchQuery"
        placeholder="Search clipboard"
        class="text-sm font-light"
        data-hotkeys
        @keydown.esc="blur" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
