<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import type { InputGroupRootVariants } from '.'
import { cn } from '@/lib/utils'
import { inputGroupVariants } from '.'

const props = defineProps<{
  variant?: InputGroupRootVariants['variant']
  class?: HTMLAttributes['class']
}>()
</script>

<template>
  <div
    data-slot="input-group"
    role="group"
    :class="cn(inputGroupVariants({ variant: props.variant }), props.class)"
  >
    <slot />
  </div>
</template>
