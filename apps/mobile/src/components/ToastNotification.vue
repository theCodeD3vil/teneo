<script setup lang="ts">
import IconCheck from "~icons/tabler/check";

import { useToast } from "../composables/useToast";

const { activeToast, dismissToast } = useToast();
</script>

<template>
  <Teleport to="body">
    <Transition name="toast-fade">
      <div
        v-if="activeToast"
        class="pointer-events-none fixed inset-x-0 bottom-8 z-50 flex justify-center px-4"
        style="
          bottom: max(
            2rem,
            calc(
              var(--safe-area-inset-bottom, env(safe-area-inset-bottom)) + 1rem
            )
          );
        ">
        <div
          class="bg-foreground text-background pointer-events-auto flex items-center gap-2.5 rounded-full px-4 py-2.5 shadow-lg"
          role="status"
          aria-live="polite"
          @click="dismissToast">
          <span
            class="bg-primary/20 text-primary flex size-5 items-center justify-center rounded-full">
            <IconCheck class="size-3.5 stroke-[2.5]" />
          </span>
          <span class="text-xs font-semibold tracking-wide">
            {{ activeToast.message }}
          </span>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.toast-fade-enter-active,
.toast-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.toast-fade-enter-from,
.toast-fade-leave-to {
  opacity: 0;
  transform: translateY(12px) scale(0.96);
}
</style>
