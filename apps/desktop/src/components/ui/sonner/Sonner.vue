<script lang="ts" setup>
import type { ToasterProps } from 'vue-sonner'

import CircleCheckIcon from '~icons/tabler/circle-check'
import InfoCircleIcon from '~icons/tabler/info-circle'
import LoaderIcon from '~icons/tabler/loader-2'
import CircleXIcon from '~icons/tabler/circle-x'
import AlertTriangleIcon from '~icons/tabler/alert-triangle'
import XIcon from '~icons/tabler/x'
import { reactiveOmit } from '@vueuse/core'
import { Toaster as Sonner } from 'vue-sonner'
import { cn } from '@/lib/utils'

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, 'class', 'toastOptions')
</script>

<template>
  <Sonner
    :class="cn('toaster group', props.class)"
    :style="{
      '--normal-bg': 'var(--popover)',
      '--normal-text': 'var(--popover-foreground)',
      '--normal-border': 'var(--border)',
      '--border-radius': 'var(--radius)',
      '--gray2': 'hsl(var(--popover) / 0.9)',
      '--gray3': 'var(--border)',
      '--gray4': 'var(--border)',
      '--gray5': 'var(--border)',
      '--gray12': 'var(--popover-foreground)',
    }"
    :toast-options="props.toastOptions ?? {
      classes: {
        toast: 'rounded-2xl',
      },
    }"
    v-bind="delegatedProps"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoCircleIcon class="size-4" />
    </template>
    <template #warning-icon>
      <AlertTriangleIcon class="size-4" />
    </template>
    <template #error-icon>
      <CircleXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <LoaderIcon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>
