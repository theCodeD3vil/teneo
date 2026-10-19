<script setup lang="ts">
import TestTubeIcon from "~icons/hugeicons/test-tube";

import { Badge } from "@/components/ui/badge";
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
