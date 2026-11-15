<script setup lang="ts">
import { Badge } from "@teneo/ui/components/badge";
import TestTubeIcon from "~icons/tabler/test-pipe";
</script>

<template>
  <Badge
    variant="outline"
    title="This feature is in beta"
    class="text-muted-foreground border-input h-[1.25rem] gap-0.5 rounded-[0.625rem] px-2 align-text-bottom text-[0.75rem] font-semibold">
    <TestTubeIcon />
    Beta
  </Badge>
</template>
