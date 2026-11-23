<script setup lang="ts">
defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <!-- a disabled fieldset disables every control inside it, whatever the slot holds -->
  <fieldset :disabled="disabled" class="min-w-0 disabled:opacity-50">
    <div class="flex min-h-12 items-center justify-between gap-6 px-4 py-3">
      <div class="grid min-w-0 gap-1">
        <div class="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <span class="text-sm font-medium">
            <slot name="label" />
          </span>
          <slot name="status" />
        </div>
        <span
          v-if="$slots.description"
          class="text-muted-foreground max-w-md text-xs leading-relaxed">
          <slot name="description" />
        </span>
      </div>
      <!-- the control: switch, select, button… -->
      <slot />
    </div>
    <!-- full-width extra below the row, e.g. a progress bar -->
    <div v-if="$slots.footer" class="px-4 pb-3">
      <slot name="footer" />
    </div>
  </fieldset>
</template>
