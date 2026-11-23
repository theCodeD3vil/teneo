<script setup lang="ts">
withDefaults(
  defineProps<{
    tone?: "neutral" | "success" | "warning" | "danger";
    live?: boolean;
  }>(),
  { tone: "neutral" },
);

const styles = {
  neutral: { badge: "bg-foreground/8", dot: "bg-foreground/50" },
  success: { badge: "bg-success/15", dot: "bg-success" },
  warning: { badge: "bg-warning/15", dot: "bg-warning" },
  danger: { badge: "bg-destructive/15", dot: "bg-destructive" },
};
</script>

<template>
  <span
    :role="live ? 'status' : undefined"
    class="inline-flex w-fit items-center gap-1.5 rounded-full px-2 py-0.5 text-xs leading-4 font-medium"
    :class="styles[tone].badge">
    <slot name="icon">
      <span
        aria-hidden="true"
        class="size-1.5 shrink-0 rounded-full"
        :class="styles[tone].dot" />
    </slot>
    <slot />
  </span>
</template>
