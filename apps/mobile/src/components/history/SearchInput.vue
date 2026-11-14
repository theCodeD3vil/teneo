<script setup lang="ts">
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@teneo/ui/components/input-group";
import { ref } from "vue";
import SearchIcon from "~icons/tabler/search";
import ClearIcon from "~icons/tabler/x";

const searchInputContainer = ref<HTMLElement | null>(null);
const searchQuery = defineModel<string>({ default: "" });

function blur(): void {
  searchInputContainer.value?.querySelector("input")?.blur();
}

defineExpose({ blur });
</script>

<template>
  <div ref="searchInputContainer" class="w-full">
    <InputGroup variant="transparent">
      <InputGroupInput
        v-model="searchQuery"
        type="search"
        enterkeyhint="search"
        placeholder="Search clipboard"
        class="text-sm [&::-webkit-search-cancel-button]:hidden"
        @keydown.enter="blur" />
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <!-- a phone keyboard has no Esc to clear the field -->
      <InputGroupAddon v-if="searchQuery" align="inline-end">
        <InputGroupButton
          size="icon-xs"
          variant="ghost"
          aria-label="Clear search"
          @click="searchQuery = ''">
          <ClearIcon />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
