<script setup lang="ts">
import { Badge } from "@teneo/ui/components/badge";
import TestTubeIcon from "~icons/tabler/test-pipe";
</script>

<template>
  <Badge
    variant="outline"
    title="This feature is in beta"
    class="text-foreground/60 h-4 gap-0.5 px-1.5 align-text-bottom text-[10px]">
    <TestTubeIcon />
    Beta
  </Badge>
</template>
