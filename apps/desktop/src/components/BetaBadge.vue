<script setup lang="ts">
import { Badge } from "@teneo/ui/components/badge";
import TestTubeIcon from "~icons/tabler/test-pipe";
</script>

<template>
  <Badge
    variant="outline"
    title="This feature is in beta"
    class="border-info/15 bg-info/10 text-foreground/80 h-5 gap-1 rounded-full px-1.5 align-middle text-[10px] leading-none font-medium">
    <TestTubeIcon aria-hidden="true" class="text-info size-3" />
    Beta
  </Badge>
</template>
