<script setup lang="ts">
import type { HTMLAttributes } from 'vue'

import { HugeiconsIcon } from '@hugeicons/vue'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'

const props = defineProps<{
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <HugeiconsIcon :icon="Loading03Icon" role="status" aria-label="Loading" :class="cn('size-4 animate-spin', props.class)" />
</template>
