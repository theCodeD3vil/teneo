<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { ButtonGroup } from "@teneo/ui/components/button-group";
import Button from "@teneo/ui/components/button/Button.vue";
import { detectCodeLanguage, highlightCode } from "@teneo/ui/utils/highlight";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import { convertCase, type TextCase } from "@teneo/ui/utils/text-case";
import { computedAsync } from "@vueuse/core";
import {
  type Component,
  type ComponentPublicInstance,
  computed,
  ref,
  watch,
} from "vue";
import ResetIcon from "~icons/tabler/arrow-back-up";
import RevealIcon from "~icons/tabler/eye";
import ConcealIcon from "~icons/tabler/eye-off";
import CapitalizeIcon from "~icons/tabler/letter-case";
import LowerCaseIcon from "~icons/tabler/letter-case-lower";
import CamelCaseIcon from "~icons/tabler/letter-case-toggle";
import UpperCaseIcon from "~icons/tabler/letter-case-upper";
import KebabCaseIcon from "~icons/tabler/minus";
import SnakeCaseIcon from "~icons/tabler/underline";

import { useSettings } from "../../composables/useSettings";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

/** the shown text after a case change, for the Copy button; null without one */
const convertedText = defineModel<string | null>("convertedText", {
  default: null,
});

const caseActions = [
  { textCase: "upper", label: "UPPERCASE", icon: UpperCaseIcon },
  { textCase: "lower", label: "lowercase", icon: LowerCaseIcon },
  { textCase: "capitalize", label: "Capitalize", icon: CapitalizeIcon },
  { textCase: "camel", label: "camelCase", icon: CamelCaseIcon },
  { textCase: "snake", label: "snake_case", icon: SnakeCaseIcon },
  { textCase: "kebab", label: "kebab-case", icon: KebabCaseIcon },
] as const satisfies ReadonlyArray<{
  textCase: TextCase;
  label: string;
  icon: Component;
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
    paddingStart: 12,
    paddingEnd: 12,
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
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <div class="flex min-h-9 items-center gap-2">
      <ButtonGroup v-if="!hasSecrets">
        <Button
          v-for="action in caseActions"
          :key="action.textCase"
          :variant="textCase === action.textCase ? 'secondary' : 'outline'"
          size="icon"
          :aria-label="action.label"
          :aria-pressed="textCase === action.textCase"
          @click="toggleCase(action.textCase)">
          <component :is="action.icon" />
        </Button>
      </ButtonGroup>
      <template v-else-if="settings.hideSecrets">
        <Button
          variant="outline"
          size="sm"
          class="text-xs"
          @click="isRevealed = !isRevealed">
          <ConcealIcon v-if="isRevealed" />
          <RevealIcon v-else />
          {{ isRevealed ? "Hide" : "Reveal" }}
        </Button>
        <span class="text-foreground/50 truncate text-xs">
          {{ secretLabels }}
        </span>
      </template>
      <Button
        v-if="textCase"
        variant="ghost"
        size="icon"
        aria-label="Reset text"
        @click="textCase = null">
        <ResetIcon />
      </Button>

      <span v-if="language" class="text-foreground/50 ml-auto text-xs">
        {{ language.name }}
      </span>
    </div>

    <div
      ref="viewport"
      class="bg-foreground/5 min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-md select-text">
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
          class="absolute inset-x-3 top-0 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap"
          :style="{ transform: `translateY(${row.start}px)` }"
          v-text="rows[row.index] || ' '" />
      </div>
      <!-- hljs escapes the text, so its output is safe to render as HTML -->
      <pre
        v-else-if="highlightedHtml"
        class="hljs p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
        v-html="highlightedHtml" />
      <pre
        v-else
        class="p-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap"
        >{{ previewText }}</pre>
    </div>
    <p v-if="isCapped" class="text-foreground/50 text-xs">
      Showing the first {{ previewTextLimit.toLocaleString() }} of
      {{ shownText.length.toLocaleString() }} characters. Copy takes all of it.
    </p>
  </div>
</template>
