<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { detectCodeLanguage, highlightCode } from "@teneo/ui/utils/highlight";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import { convertCase, type TextCase } from "@teneo/ui/utils/text-case";
import { computedAsync } from "@vueuse/core";
import { type ComponentPublicInstance, computed, ref, watch } from "vue";
import RevealIcon from "~icons/tabler/eye";
import ConcealIcon from "~icons/tabler/eye-off";
import ResetIcon from "~icons/tabler/restore";

import { useSettings } from "../../composables/useSettings";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

/** the shown text after a case change, for the Copy button; null without one */
const convertedText = defineModel<string | null>("convertedText", {
  default: null,
});

const caseActions = [
  // each button shows its case in a few letters
  { textCase: "upper", label: "UPPERCASE", glyph: "AA" },
  { textCase: "lower", label: "lowercase", glyph: "aa" },
  { textCase: "capitalize", label: "Capitalize", glyph: "Aa" },
  { textCase: "camel", label: "camelCase", glyph: "aB" },
  { textCase: "snake", label: "snake_case", glyph: "a_b" },
  { textCase: "kebab", label: "kebab-case", glyph: "a-b" },
] as const satisfies ReadonlyArray<{
  textCase: TextCase;
  label: string;
  glyph: string;
}>;

const { settings } = useSettings();
const textCase = ref<TextCase | null>(null);
const isRevealed = ref(false);

const text = computed(() => props.item.text ?? "");
const hasSecrets = computed(() => props.item.secrets.length > 0);
const isMasked = computed(
  () => hasSecrets.value && settings.value.hideSecrets && !isRevealed.value,
);
const secretLabels = computed(() =>
  [...new Set(props.item.secrets.map(({ label }) => label))].join(", "),
);

// Case actions only change what's shown here; Copy takes what's shown.
// Items with secrets get no case actions, so they always copy as copied.
const shownText = computed(() => {
  if (isMasked.value) {
    return maskSecrets(text.value, props.item.secrets)
      .map((part) => part.text)
      .join("");
  }
  return textCase.value ? convertCase(text.value, textCase.value) : text.value;
});

watch(
  [textCase, shownText],
  () => (convertedText.value = textCase.value ? shownText.value : null),
  { immediate: true },
);

// A copy can be megabytes of text. The preview shows at most this much, and
// past longText renders only the rows on screen. Copying still takes all of it.
const previewTextLimit = 200_000;
const longText = 20_000;
// Long lines are cut into rows this long, at a space where there is one
const rowLength = 1_000;

const isCapped = computed(() => shownText.value.length > previewTextLimit);
const previewText = computed(() => shownText.value.slice(0, previewTextLimit));
const isLong = computed(() => previewText.value.length > longText);

function splitIntoRows(text: string): string[] {
  const rows: string[] = [];
  for (const line of text.split("\n")) {
    let rest = line;
    while (rest.length > rowLength) {
      const space = rest.lastIndexOf(" ", rowLength);
      const end = space > rowLength / 2 ? space + 1 : rowLength;
      rows.push(rest.slice(0, end));
      rest = rest.slice(end);
    }
    rows.push(rest);
  }
  return rows;
}

const rows = computed(() =>
  isLong.value ? splitIntoRows(previewText.value) : [],
);

const viewport = ref<HTMLElement | null>(null);
const virtualizer = useVirtualizer(
  computed(() => ({
    count: rows.value.length,
    getScrollElement: () => viewport.value,
    estimateSize: () => 23,
    overscan: 10,
    paddingStart: 24,
    paddingEnd: 24,
  })),
);
const virtualRows = computed(() => virtualizer.value.getVirtualItems());

function measureRow(row: Element | ComponentPublicInstance | null): void {
  if (row instanceof Element) virtualizer.value.measureElement(row);
}

// Detected once from the copied text; a case change keeps the language
const language = computedAsync(() => detectCodeLanguage(text.value), null);
const highlightedHtml = computedAsync(
  () =>
    language.value
      ? highlightCode(shownText.value, language.value.id)
      : Promise.resolve(null),
  null,
);

function toggleCase(nextCase: TextCase): void {
  textCase.value = textCase.value === nextCase ? null : nextCase;
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4">
    <!-- the case buttons sit in the screen's top bar, beside the back button:
         placed against the screen, over the bar's free end -->
    <div
      class="absolute top-0 right-0 left-[3.625rem] flex h-[3rem] items-center justify-end gap-2">
      <div
        v-if="!hasSecrets"
        class="bg-card flex shrink-0 rounded-full p-[3px] font-mono">
        <button
          v-for="action in caseActions"
          :key="action.textCase"
          type="button"
          class="h-[2.5rem] w-[2.625rem] rounded-full text-[0.8125rem] font-medium transition-colors"
          :class="textCase === action.textCase && 'bg-cta text-cta-foreground'"
          :aria-label="action.label"
          :aria-pressed="textCase === action.textCase"
          @click="toggleCase(action.textCase)">
          {{ action.glyph }}
        </button>
      </div>
      <template v-else-if="settings.hideSecrets">
        <button
          type="button"
          class="pill-button"
          @click="isRevealed = !isRevealed">
          <ConcealIcon v-if="isRevealed" />
          <RevealIcon v-else />
          {{ isRevealed ? "Hide" : "Reveal" }}
        </button>
        <span class="text-muted-foreground truncate text-[0.8125rem]">
          {{ secretLabels }}
        </span>
      </template>
      <!-- it grows out of the bar's end and shrinks back into it, so the
           case buttons slide over instead of jumping -->
      <Transition name="reset-button">
        <button
          v-if="textCase"
          type="button"
          class="text-muted-foreground active:bg-muted grid h-[2.75rem] w-[2.75rem] shrink-0 place-items-center overflow-hidden rounded-full"
          aria-label="Reset text"
          @click="textCase = null">
          <ResetIcon class="size-[1.25rem]" />
        </button>
      </Transition>
    </div>

    <div class="relative min-h-0 flex-1">
      <div
        ref="viewport"
        class="code-panel bg-panel text-panel-foreground size-full overflow-y-auto overscroll-contain rounded-[2rem] select-text">
        <!-- only the rows on screen are in the page -->
        <div
          v-if="isLong"
          class="relative w-full"
          :style="{ height: `${virtualizer.getTotalSize()}px` }">
          <div
            v-for="row in virtualRows"
            :key="row.key as number"
            :ref="measureRow"
            :data-index="row.index"
            class="absolute inset-x-6 top-0 font-sans text-[1rem] leading-relaxed break-words whitespace-pre-wrap"
            :style="{ transform: `translateY(${row.start}px)` }"
            v-text="rows[row.index] || ' '" />
        </div>
        <!-- hljs escapes the text, so its output is safe to render as HTML -->
        <pre
          v-else-if="highlightedHtml"
          class="hljs p-6 font-mono text-[0.875rem] leading-[1.5rem] break-words whitespace-pre-wrap"
          v-html="highlightedHtml" />
        <pre
          v-else
          class="p-6 font-sans text-[1rem] leading-relaxed break-words whitespace-pre-wrap"
          >{{ previewText }}</pre>
      </div>
      <!-- the language the code was read as, in the panel's corner -->
      <span
        v-if="language"
        class="bg-panel/80 text-panel-muted pointer-events-none absolute top-3 right-5 rounded-full px-2 text-[0.75rem] leading-[1.25rem]">
        {{ language.name }}
      </span>
    </div>
    <p v-if="isCapped" class="text-muted-foreground text-xs">
      Showing the first {{ previewTextLimit.toLocaleString() }} of
      {{ shownText.length.toLocaleString() }} characters. Copy takes all of it.
    </p>
  </div>
</template>
