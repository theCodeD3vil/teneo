<script setup lang="ts">
import { Icon } from "@iconify/vue";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group";
</script>

<template>
  <div class="w-full gap-6">
    <InputGroup variant="transparent">
      <InputGroupInput placeholder="Search clipboard" />
      <InputGroupAddon>
        <Icon icon="hugeicons:search-01" />
      </InputGroupAddon>
    </InputGroup>
  </div>
</template>
