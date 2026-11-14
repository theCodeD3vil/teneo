<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@/lib/utils'
import type { InputVariants } from '@/components/ui/input'
import { Input } from '@/components/ui/input'

const props = defineProps<{
  variant?: InputVariants['variant']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <Input
    data-slot="input-group-control"
    :variant="props.variant"
    :class="cn(
      'rounded-none border-0 bg-transparent shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent flex-1',
      props.class,
    )"
  />
</template>
