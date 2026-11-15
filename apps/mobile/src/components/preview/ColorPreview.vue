<script setup lang="ts">
import {
  type ColorFormats,
  getColorFormats,
  getColorShades,
} from "@teneo/ui/utils/color-formats";
import { computed, onUnmounted, ref } from "vue";
import TickIcon from "~icons/tabler/check";
import CopyIcon from "~icons/tabler/copy";

import { useClient } from "../../client";
import BottomSheet from "../BottomSheet.vue";
import SheetGroup from "../SheetGroup.vue";

/** A colour as the Mac's preview shows it: its value and name, the formats
 *  it can be written in, and its shades, each of them copyable. */
const props = defineProps<{
  color: string;
}>();

const client = useClient();

const colorFormats = computed(() => getColorFormats(props.color));
// A colour that can't be read still shows as copied, just without conversions
const hex = computed(() => colorFormats.value?.hex ?? props.color);
const shades = computed(() => getColorShades(props.color));
const originalShade = 5; // the middle of getColorShades' eleven
// The copied colour's ring is one of its own shades, three steps away: darker
// on a light colour, lighter on a dark one. Opaque, so it shows on
// translucent colours.
const ringColor = computed(() => {
  const original = shades.value[originalShade];
  if (!original) return undefined;
  const ring =
    shades.value[
      original.lightness > 0.6 ? originalShade + 3 : originalShade - 3
    ];
  return ring?.hex.slice(0, 7);
});

// Each value copies as text. A tick takes the copy icon's place for a moment.
const copiedKey = ref<string | null>(null);
let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

function copyValue(key: string, value: string): void {
  void client
    .copyText(value)
    .then(() => {
      copiedKey.value = key;
      clearTimeout(copiedTimeout);
      copiedTimeout = setTimeout(() => (copiedKey.value = null), 1500);
    })
    .catch(() => undefined);
}

onUnmounted(() => clearTimeout(copiedTimeout));

// A tap on a shade opens a sheet with every format it can be copied in, its
// name last when it has one. The sheet keeps its shade after closing, so it
// still has content while it slides away.
const openShadeIndex = ref(originalShade);
const isShadeSheetOpen = ref(false);
const openShade = computed<ColorFormats | undefined>(
  () => shades.value[openShadeIndex.value],
);
const shadeOptions = computed(() => {
  const shade = openShade.value;
  if (!shade) return [];
  return [
    { label: "HEX", value: shade.hex },
    ...shade.formats,
    ...(shade.name ? [{ label: "Name", value: shade.name }] : []),
  ];
});

function showShade(index: number): void {
  openShadeIndex.value = index;
  isShadeSheetOpen.value = true;
}

function copyShade(value: string): void {
  copyValue(`shade-${openShadeIndex.value}`, value);
  isShadeSheetOpen.value = false;
}
</script>

<template>
  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <div class="flex min-h-full flex-col justify-center gap-5 py-1">
      <div class="flex items-center gap-4 px-2">
        <!-- the checkerboard shows through a translucent colour -->
        <div
          class="checkerboard ring-card size-[5.5rem] shrink-0 overflow-hidden rounded-[1.75rem] ring-[6px]">
          <div class="size-full" :style="{ background: color }" />
        </div>
        <div class="flex min-w-0 flex-col gap-0.5">
          <div class="flex items-center gap-1">
            <span
              class="truncate font-mono text-[1.5rem] leading-[2rem] font-medium select-text">
              {{ hex }}
            </span>
            <button
              type="button"
              class="text-muted-foreground active:bg-muted grid size-[2.75rem] shrink-0 place-items-center rounded-full"
              aria-label="Copy hex"
              @click="copyValue('hex', hex)">
              <TickIcon
                v-if="copiedKey === 'hex'"
                class="text-success size-[1.25rem]" />
              <CopyIcon v-else class="size-[1.25rem]" />
            </button>
          </div>
          <span
            v-if="colorFormats?.name"
            class="text-muted-foreground text-sm capitalize">
            {{ colorFormats.name }}
          </span>
        </div>
      </div>

      <template v-if="colorFormats">
        <div class="bg-card divide-hairline grid divide-y rounded-[1.5rem]">
          <div
            v-for="format in colorFormats.formats"
            :key="format.label"
            class="flex min-h-[3.5rem] items-center gap-3 py-1.5 pr-2 pl-[1.125rem]">
            <span
              class="text-muted-foreground w-[3.25rem] shrink-0 text-[0.8125rem] font-semibold">
              {{ format.label }}
            </span>
            <span
              class="min-w-0 flex-1 truncate font-mono text-[0.9375rem] select-text">
              {{ format.value }}
            </span>
            <button
              type="button"
              class="text-muted-foreground active:bg-muted grid size-[2.75rem] shrink-0 place-items-center rounded-full"
              :aria-label="`Copy ${format.label}`"
              @click="copyValue(format.label, format.value)">
              <TickIcon
                v-if="copiedKey === format.label"
                class="text-success size-[1.25rem]" />
              <CopyIcon v-else class="size-[1.25rem]" />
            </button>
          </div>
        </div>

        <!-- five lighter, the colour itself (ringed), five darker -->
        <div class="grid gap-[0.625rem]">
          <span class="group-label px-2">Shades</span>
          <div class="flex gap-1.5">
            <button
              v-for="(shade, index) in shades"
              :key="index"
              type="button"
              :aria-label="`Shade ${shade.hex}`"
              :style="
                index === originalShade
                  ? { '--ring-color': ringColor }
                  : undefined
              "
              :class="[
                'checkerboard h-[3rem] min-w-0 flex-1 overflow-hidden rounded-[0.75rem] transition-transform active:scale-90',
                index === originalShade && 'ring-2 ring-(--ring-color)',
              ]"
              @click="showShade(index)">
              <span
                class="flex size-full items-center justify-center"
                :style="{ background: shade.hex }">
                <TickIcon
                  v-if="copiedKey === `shade-${index}`"
                  class="size-4 text-white drop-shadow" />
              </span>
            </button>
          </div>
        </div>
      </template>
      <p v-else class="text-muted-foreground px-2 text-sm">
        This color can't be shown in other formats.
      </p>
    </div>

    <BottomSheet
      v-model:open="isShadeSheetOpen"
      :title="openShade?.hex ?? ''"
      description="Copy this shade as">
      <SheetGroup>
        <button
          v-for="option in shadeOptions"
          :key="option.label"
          type="button"
          class="active:bg-muted flex min-h-[3.5rem] w-full items-center gap-3 px-[1.125rem] py-2 text-left transition-colors"
          @click="copyShade(option.value)">
          <span
            class="text-muted-foreground w-[3.25rem] shrink-0 text-[0.8125rem] font-semibold">
            {{ option.label }}
          </span>
          <span class="min-w-0 flex-1 truncate font-mono text-[0.9375rem]">
            {{ option.value }}
          </span>
        </button>
      </SheetGroup>
    </BottomSheet>
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
