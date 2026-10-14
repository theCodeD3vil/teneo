<script setup lang="ts">
import SearchIcon from "~icons/hugeicons/search-01";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
</script>

<template>
  <div class="w-full gap-6">
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
