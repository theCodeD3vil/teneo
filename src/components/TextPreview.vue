<script setup lang="ts">
import { computedAsync } from "@vueuse/core";
import { type Component, computed, ref } from "vue";
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

      <ScrollArea class="bg-foreground/5 min-h-0 flex-1 rounded-md">
        <!-- hljs escapes the text, so its output is safe to render as HTML -->
        <pre
          v-if="highlightedHtml"
          class="hljs p-3 font-mono text-xs leading-relaxed break-words whitespace-pre-wrap"
          v-html="highlightedHtml" />
        <pre
          v-else
          class="p-3 font-sans text-sm leading-relaxed break-words whitespace-pre-wrap"
          >{{ shownText }}</pre>
      </ScrollArea>
    </div>
  </TooltipProvider>
</template>
