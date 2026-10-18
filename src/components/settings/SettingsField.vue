<script setup lang="ts">
defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <!-- a disabled fieldset disables every control inside it, whatever the slot holds -->
  <fieldset :disabled="disabled" class="min-w-0 disabled:opacity-50">
    <div class="flex items-center justify-between gap-4 px-3 py-2.5">
      <div class="grid gap-0.5">
        <span class="text-foreground/80 text-sm font-light">
          <slot name="label" />
        </span>
        <span v-if="$slots.description" class="text-foreground/60 text-xs">
          <slot name="description" />
        </span>
      </div>
      <!-- the control: switch, select, button… -->
      <slot />
    </div>
  </fieldset>
</template>
