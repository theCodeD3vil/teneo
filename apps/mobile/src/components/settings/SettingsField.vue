<script setup lang="ts">
defineProps<{
  disabled?: boolean;
}>();
</script>

<template>
  <!-- a disabled fieldset disables every control inside it, whatever the slot holds -->
  <fieldset :disabled="disabled" class="min-w-0 disabled:opacity-50">
    <div
      class="flex min-h-[4.25rem] items-center justify-between gap-4 px-[1.125rem] py-3">
      <div class="grid min-w-0 flex-1 gap-0.5">
        <span class="text-sm font-semibold">
          <slot name="label" />
        </span>
        <span v-if="$slots.description" class="text-muted-foreground text-xs">
          <slot name="description" />
        </span>
      </div>
      <!-- the control: switch, select, button… The text wraps around it; it
           never shrinks, so a select shows its whole value -->
      <div class="flex shrink-0">
        <slot />
      </div>
    </div>
    <!-- full-width extra below the row, e.g. a form -->
    <div v-if="$slots.footer" class="px-[1.125rem] pb-4">
      <slot name="footer" />
    </div>
  </fieldset>
</template>
