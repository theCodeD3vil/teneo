<script setup lang="ts">
import { computed } from "vue";
import TickIcon from "~icons/tabler/check";
import CopyIcon from "~icons/tabler/copy";

import Button from "@/components/ui/button/Button.vue";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePreviewCopy } from "@/composables/usePreviewCopy";
import type { ClipboardHistoryItem } from "@/types/clipboard";
import { getClipboardData } from "@/utils/clipboard-items";
import {
  type ColorFormats,
  getColorFormats,
  getColorShades,
} from "@/utils/color-formats";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

const color = computed(() => props.item.color ?? "");
const colorFormats = computed(() => getColorFormats(color.value));
// A color culori can't read still shows as copied, just without conversions
const hex = computed(() => colorFormats.value?.hex ?? color.value);
const shades = computed(() => getColorShades(color.value));
const ORIGINAL_SHADE = 5; // the middle of getColorShades' eleven
// The copied color's ring is one of its own shades, three steps away: darker on
// a light color, lighter on a dark one. Opaque, so it shows on translucent colors.
const ringColor = computed(() => {
  const original = shades.value[ORIGINAL_SHADE];
  if (!original) return undefined;
  const ring =
    shades.value[
      original.lightness > 0.6 ? ORIGINAL_SHADE + 3 : ORIGINAL_SHADE - 3
    ];
  return ring?.hex.slice(0, 7);
});

// Each value copies as text; Enter copies the color itself, as on the list
const { copiedKey, copy } = usePreviewCopy(() => getClipboardData(props.item));

function copyValue(key: string, value: string): void {
  void copy(false, { text: value }, key).catch(() => undefined);
}

// Every format a shade's dropdown offers, its name last when it has one
function copyOptions(shade: ColorFormats) {
  return [
    { label: "HEX", value: shade.hex },
    ...shade.formats,
    ...(shade.name ? [{ label: "Name", value: shade.name }] : []),
  ];
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col items-center justify-center">
    <div class="flex w-full max-w-md flex-col gap-5">
      <div class="flex items-center gap-3">
        <!-- the checkerboard shows through a translucent color -->
        <div class="checkerboard size-12 shrink-0 overflow-hidden rounded-lg">
          <div
            class="border-foreground/10 size-full rounded-lg border"
            :style="{ background: color }" />
        </div>
        <div class="flex min-w-0 flex-col">
          <div class="flex items-center gap-1">
            <span class="truncate font-mono text-xl">{{ hex }}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-foreground/60"
              aria-label="Copy hex"
              @click="copyValue('hex', hex)">
              <TickIcon v-if="copiedKey === 'hex'" class="text-success" />
              <CopyIcon v-else />
            </Button>
          </div>
          <span
            v-if="colorFormats?.name"
            class="text-foreground/60 text-sm capitalize">
            {{ colorFormats.name }}
          </span>
        </div>
      </div>

      <template v-if="colorFormats">
        <div
          class="bg-foreground/5 divide-foreground/5 flex flex-col divide-y rounded-md">
          <div
            v-for="format in colorFormats.formats"
            :key="format.label"
            class="flex items-center gap-3 py-1.5 pr-1.5 pl-3">
            <span class="text-foreground/50 w-12 shrink-0 text-xs">
              {{ format.label }}
            </span>
            <span class="min-w-0 flex-1 truncate font-mono text-sm">
              {{ format.value }}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              class="text-foreground/60"
              :aria-label="`Copy ${format.label}`"
              @click="copyValue(format.label, format.value)">
              <TickIcon
                v-if="copiedKey === format.label"
                class="text-success" />
              <CopyIcon v-else />
            </Button>
          </div>
        </div>

        <!-- five lighter, the color itself (ringed), five darker -->
        <div class="flex flex-col gap-2">
          <span class="text-foreground/50 text-xs">Shades</span>
          <div class="flex gap-1.5">
            <DropdownMenu v-for="(shade, index) in shades" :key="index">
              <DropdownMenuTrigger as-child>
                <button
                  type="button"
                  :aria-label="`Shade ${shade.hex}`"
                  :style="
                    index === ORIGINAL_SHADE
                      ? { '--ring-color': ringColor }
                      : undefined
                  "
                  :class="[
                    'checkerboard h-9 flex-1 overflow-hidden rounded-md',
                    index === ORIGINAL_SHADE && 'ring-2 ring-(--ring-color)',
                  ]">
                  <span
                    class="border-foreground/10 flex size-full items-center justify-center rounded-md border"
                    :style="{ background: shade.hex }">
                    <TickIcon
                      v-if="copiedKey === `shade-${index}`"
                      class="size-4 text-white drop-shadow" />
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent class="w-auto">
                <DropdownMenuItem
                  v-for="option in copyOptions(shade)"
                  :key="option.label"
                  class="gap-3"
                  @select="copyValue(`shade-${index}`, option.value)">
                  <span class="text-foreground/50 w-10 shrink-0 text-xs">
                    {{ option.label }}
                  </span>
                  <span class="font-mono text-xs whitespace-nowrap">{{
                    option.value
                  }}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </template>
      <p v-else class="text-foreground/50 text-sm">
        This color can't be shown in other formats.
      </p>
    </div>
  </div>
</template>

<style scoped>
.checkerboard {
  background: repeating-conic-gradient(
      color-mix(in oklch, var(--foreground) 12%, transparent) 0 25%,
      transparent 0 50%
    )
    0 0 / 12px 12px;
}
</style>
