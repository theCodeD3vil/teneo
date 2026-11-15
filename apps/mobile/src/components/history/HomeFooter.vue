<script lang="ts" setup>
import type { Component } from "vue";
import TextIcon from "~icons/tabler/align-left";
import TickIcon from "~icons/tabler/check";
import ColorIcon from "~icons/tabler/droplet";
import ImageIcon from "~icons/tabler/photo";
import SettingsIcon from "~icons/tabler/settings";
import AllIcon from "~icons/tabler/stack-2";

import { useCopiedNotice } from "../../composables/useCopiedNotice";
import { useNavigation } from "../../composables/useNavigation";
import { tabValues, type TabVariant } from "../../types/tabs";

/** The dock floating over the foot of the list: the tabs at its start,
 *  settings at its end. "Copied" rises above it for a moment. It sits on the
 *  list's bottom edge, so no card shows in a strip beneath it. */
const selectedTab = defineModel<TabVariant>("tab", { required: true });

const tabIcons: Record<TabVariant, Component> = {
  all: AllIcon,
  image: ImageIcon,
  color: ColorIcon,
  text: TextIcon,
};

const { isCopiedNoticeShown } = useCopiedNotice();
const { openSettings } = useNavigation();
</script>

<template>
  <div
    class="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center gap-3">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="translate-y-2 opacity-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-to-class="translate-y-2 opacity-0">
      <span
        v-if="isCopiedNoticeShown"
        role="status"
        class="bg-toast flex h-[2.5rem] items-center gap-2 rounded-full pr-[1.125rem] pl-[0.875rem] text-[0.9375rem] font-semibold text-white">
        <TickIcon class="size-[1.125rem]" />
        Copied
      </span>
    </Transition>

    <nav
      aria-label="History"
      class="bg-dock border-dock-border pointer-events-auto flex h-[4.25rem] w-full items-center justify-between rounded-full border p-[0.5625rem] shadow-[0_14px_32px_rgb(20_22_43/0.28)]">
      <div class="flex items-center gap-0.5">
        <button
          v-for="tab in tabValues"
          :key="tab"
          type="button"
          :aria-label="tab"
          :aria-pressed="tab === selectedTab"
          class="flex h-[3rem] min-w-[3rem] items-center justify-center rounded-full text-[0.9375rem] font-semibold transition-[background-color,color,padding] duration-200 ease-out"
          :class="
            tab === selectedTab
              ? 'bg-primary text-primary-foreground px-[1.125rem]'
              : 'text-dock-foreground px-[0.8125rem]'
          "
          @click="selectedTab = tab">
          <component :is="tabIcons[tab]" class="size-[1.375rem] shrink-0" />
          <span
            class="overflow-hidden whitespace-nowrap capitalize transition-[max-width,margin,opacity] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
            :class="
              tab === selectedTab
                ? 'ml-2 max-w-[5rem] opacity-100'
                : 'ml-0 max-w-0 opacity-0'
            ">
            {{ tab }}
          </span>
        </button>
      </div>

      <button
        type="button"
        aria-label="Settings"
        class="grid size-[3rem] place-items-center rounded-full bg-white/12 text-white transition-colors active:bg-white/20"
        @click="openSettings">
        <SettingsIcon class="size-[1.375rem]" />
      </button>
    </nav>
  </div>
</template>
