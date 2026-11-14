<script setup lang="ts">
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { computed } from "vue";
import IconCopy from "~icons/tabler/copy";
import IconEye from "~icons/tabler/eye";
import IconPin from "~icons/tabler/pin";
import IconPinnedOff from "~icons/tabler/pinned-off";
import IconShare from "~icons/tabler/share";
import IconTrash from "~icons/tabler/trash";
import IconX from "~icons/tabler/x";

const props = defineProps<{
  item: ClipboardHistoryItem | null;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  (e: "close"): void;
  (e: "copy", item: ClipboardHistoryItem): void;
  (e: "view", item: ClipboardHistoryItem): void;
  (e: "toggle-pin", item: ClipboardHistoryItem): void;
  (e: "share", item: ClipboardHistoryItem): void;
  (e: "delete", item: ClipboardHistoryItem): void;
}>();

const snippet = computed(() => {
  if (!props.item?.text) return "";
  return props.item.text.length > 80
    ? props.item.text.slice(0, 80) + "…"
    : props.item.text;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="isOpen && item"
        class="fixed inset-0 z-50 flex flex-col justify-end bg-black/60 backdrop-blur-xs"
        role="dialog"
        aria-modal="true"
        aria-label="Item actions"
        @click.self="emit('close')">
        <Transition name="slide-up">
          <div
            v-if="isOpen && item"
            class="bg-background border-border safe-area-sheet max-h-[85vh] w-full rounded-t-3xl border-t p-4 shadow-2xl">
            <!-- Sheet handle bar -->
            <div class="flex justify-center pb-3">
              <div class="bg-muted-foreground/30 h-1.5 w-12 rounded-full" />
            </div>

            <!-- Item preview snippet header -->
            <div class="mb-4 flex items-center justify-between px-2">
              <div class="min-w-0 flex-1">
                <p class="text-foreground line-clamp-2 text-sm font-medium">
                  {{ snippet }}
                </p>
                <p class="text-muted-foreground mt-0.5 text-xs">
                  {{ item.sourceApp?.name ?? "Unknown device" }}
                </p>
              </div>
              <button
                class="text-muted-foreground hover:text-foreground ml-3 flex size-10 min-h-12 min-w-12 items-center justify-center rounded-full"
                aria-label="Close sheet"
                @click="emit('close')">
                <IconX class="size-5" />
              </button>
            </div>

            <!-- Action buttons: 48dp+ touch target -->
            <div class="space-y-1">
              <button
                class="hover:bg-muted active:bg-muted/80 flex h-12 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors"
                @click="emit('copy', item)">
                <IconCopy class="text-muted-foreground size-5" />
                <span>Copy to clipboard</span>
              </button>

              <button
                class="hover:bg-muted active:bg-muted/80 flex h-12 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors"
                @click="emit('view', item)">
                <IconEye class="text-muted-foreground size-5" />
                <span>View full item</span>
              </button>

              <button
                class="hover:bg-muted active:bg-muted/80 flex h-12 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors"
                @click="emit('toggle-pin', item)">
                <component
                  :is="item.pinned ? IconPinnedOff : IconPin"
                  class="text-muted-foreground size-5" />
                <span>{{ item.pinned ? "Unpin item" : "Pin to top" }}</span>
              </button>

              <button
                class="hover:bg-muted active:bg-muted/80 flex h-12 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors"
                @click="emit('share', item)">
                <IconShare class="text-muted-foreground size-5" />
                <span>Share</span>
              </button>

              <div class="border-border my-2 border-t" />

              <button
                class="text-destructive hover:bg-destructive/10 active:bg-destructive/20 flex h-12 w-full items-center gap-3.5 rounded-xl px-3.5 text-left text-sm font-medium transition-colors"
                @click="emit('delete', item)">
                <IconTrash class="size-5" />
                <span>Delete item</span>
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.safe-area-sheet {
  padding-bottom: max(
    1.5rem,
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom))
  );
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.2s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>
