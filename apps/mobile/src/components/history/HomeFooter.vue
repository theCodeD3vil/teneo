<script lang="ts" setup>
import Button from "@teneo/ui/components/button/Button.vue";
import Kbd from "@teneo/ui/components/kbd/Kbd.vue";
import TickIcon from "~icons/tabler/check";
import SettingsIcon from "~icons/tabler/settings";

import { useCopiedNotice } from "../../composables/useCopiedNotice";
import { useNavigation } from "../../composables/useNavigation";

defineProps<{
  clipboardItemsCount: number;
}>();

const { isCopiedNoticeShown } = useCopiedNotice();
const { openSettings } = useNavigation();
</script>

<template>
  <div class="flex items-center justify-between gap-4 p-1">
    <span class="text-foreground/60 text-xs">
      {{ clipboardItemsCount }} items
    </span>

    <Transition
      mode="out-in"
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-y-1 opacity-0 scale-95"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="-translate-y-1 opacity-0 scale-95">
      <Kbd
        v-if="isCopiedNoticeShown"
        class="bg-success/15! text-success text-xs">
        <TickIcon />
        Copied
      </Kbd>
      <span v-else class="text-foreground/70 text-xs">
        Tap to copy · hold for more
      </span>
    </Transition>

    <Button
      variant="ghost"
      size="icon"
      aria-label="Settings"
      class="hover:bg-foreground/5! dark:hover:bg-foreground/10! text-foreground/70 hover:text-foreground"
      @click="openSettings">
      <SettingsIcon />
    </Button>
  </div>
</template>
