<script setup lang="ts">
import { ref } from "vue";
import SearchIcon from "~icons/hugeicons/search-01";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";

const searchInputContainer = ref<HTMLElement | null>(null);

function focus(): void {
  searchInputContainer.value?.querySelector("input")?.focus();
}

defineExpose({ focus });
</script>

<template>
  <div ref="searchInputContainer" class="w-full gap-6">
    <InputGroup variant="transparent">
      <InputGroupInput
        placeholder="Search clipboard"
        class="text-sm font-light" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
