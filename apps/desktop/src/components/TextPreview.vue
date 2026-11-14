<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import { computedAsync } from "@vueuse/core";
import {
  type Component,
  type ComponentPublicInstance,
  computed,
  onMounted,
  ref,
} from "vue";
import ResetIcon from "~icons/tabler/arrow-back-up";
import TickIcon from "~icons/tabler/check";
import CopyIcon from "~icons/tabler/copy";
import RevealIcon from "~icons/tabler/eye";
import ConcealIcon from "~icons/tabler/eye-off";
import CapitalizeIcon from "~icons/tabler/letter-case";
import LowerCaseIcon from "~icons/tabler/letter-case-lower";
import CamelCaseIcon from "~icons/tabler/letter-case-toggle";
import UpperCaseIcon from "~icons/tabler/letter-case-upper";
import KebabCaseIcon from "~icons/tabler/minus";
import SnakeCaseIcon from "~icons/tabler/underline";

import { ButtonGroup } from "@/components/ui/button-group";
import Button from "@/components/ui/button/Button.vue";
import ScrollArea from "@/components/ui/scroll-area/ScrollArea.vue";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { usePreviewCopy } from "@/composables/usePreviewCopy";
import { useSettings } from "@/composables/useSettings";
import type { ClipboardHistoryItem } from "@/types/clipboard";
import { getClipboardData } from "@/utils/clipboard-items";
import { detectCodeLanguage, highlightCode } from "@/utils/highlight";
import { maskSecrets } from "@/utils/secrets";
import { convertCase, type TextCase } from "@/utils/text-case";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

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
  () => hasSecrets.value && settings.value.maskSecrets && !isRevealed.value,
);
const secretLabels = computed(() =>
  [...new Set(props.item.secrets.map(({ label }) => label))].join(", "),
);

// Case actions only change what's shown here; copying takes what's shown.
// Items with secrets get no case actions, so they always copy as copied.
const shownText = computed(() => {
  if (isMasked.value) {
    return maskSecrets(text.value, props.item.secrets)
      .map((part) => part.text)
      .join("");
  }
  return textCase.value ? convertCase(text.value, textCase.value) : text.value;
});

// A copy can be megabytes of text. WebKit lays out and hit-tests all of the
// text in the page, which made every click slow, so the preview shows at most
// this much, and past longText renders only the rows on screen. Copying still
// takes all of it.
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

const scrollArea = ref<ComponentPublicInstance | null>(null);
const viewport = ref<HTMLElement | null>(null);
onMounted(() => {
  viewport.value =
    scrollArea.value?.$el.querySelector("[data-slot=scroll-area-viewport]") ??
    null;
});

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

const { isCopied, copy } = usePreviewCopy(() =>
  textCase.value ? { text: shownText.value } : getClipboardData(props.item),
);
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex items-center gap-2">
        <ButtonGroup v-if="!hasSecrets">
          <Tooltip v-for="action in caseActions" :key="action.textCase">
            <TooltipTrigger as-child>
              <Button
                :variant="
                  textCase === action.textCase ? 'secondary' : 'outline'
                "
                size="icon-sm"
                :aria-label="action.label"
                :aria-pressed="textCase === action.textCase"
                @click="toggleCase(action.textCase)">
                <component :is="action.icon" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{{ action.label }}</TooltipContent>
          </Tooltip>
        </ButtonGroup>
        <template v-else-if="settings.maskSecrets">
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
        <Tooltip v-if="textCase">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset text"
              @click="textCase = null">
              <ResetIcon />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Reset</TooltipContent>
        </Tooltip>

        <span v-if="language" class="text-foreground/50 ml-auto text-xs">
          {{ language.name }}
        </span>
        <Tooltip>
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              :class="!language && 'ml-auto'"
              aria-label="Copy"
              @click="copy(false)">
              <TickIcon v-if="isCopied" class="text-success" />
              <CopyIcon v-else />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{{ isCopied ? "Copied" : "Copy" }}</TooltipContent>
        </Tooltip>
      </div>

      <ScrollArea
        ref="scrollArea"
        class="bg-foreground/5 min-h-0 flex-1 rounded-md">
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
      </ScrollArea>
      <p v-if="isCapped" class="text-foreground/50 text-xs">
        Showing the first {{ previewTextLimit.toLocaleString() }} of
        {{ shownText.length.toLocaleString() }} characters. Copy takes all of
        it.
      </p>
    </div>
  </TooltipProvider>
</template>
