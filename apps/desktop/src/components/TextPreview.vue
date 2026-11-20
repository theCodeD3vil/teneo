<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import { ButtonGroup } from "@teneo/ui/components/button-group";
import Button from "@teneo/ui/components/button/Button.vue";
import ScrollArea from "@teneo/ui/components/scroll-area/ScrollArea.vue";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@teneo/ui/components/tooltip";
import { detectCodeLanguage, highlightCode } from "@teneo/ui/utils/highlight";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import {
  findContact,
  formatJson,
  tidyText,
} from "@teneo/ui/utils/text-actions";
import { computedAsync } from "@vueuse/core";
import { renderSVG } from "uqr";
import { type ComponentPublicInstance, computed, onMounted, ref } from "vue";
import ResetIcon from "~icons/tabler/arrow-back-up";
import FormatIcon from "~icons/tabler/braces";
import TickIcon from "~icons/tabler/check";
import CopyIcon from "~icons/tabler/copy";
import RevealIcon from "~icons/tabler/eye";
import ConcealIcon from "~icons/tabler/eye-off";
import EmailIcon from "~icons/tabler/mail";
import PhoneIcon from "~icons/tabler/phone";
import QrIcon from "~icons/tabler/qrcode";
import TidyIcon from "~icons/tabler/wand";

import { usePreviewCopy } from "@/composables/usePreviewCopy";
import { useSettings } from "@/composables/useSettings";
import type { ClipboardHistoryItem } from "@/types/clipboard";
import { getClipboardData } from "@/utils/clipboard-items";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

const { settings } = useSettings();
// how the text is shown: as copied, tidied, or laid out as JSON
const transform = ref<"tidy" | "json" | null>(null);
const isRevealed = ref(false);

const text = computed(() => props.item.text ?? "");
const hasSecrets = computed(() => props.item.secrets.length > 0);
const isMasked = computed(
  () => hasSecrets.value && settings.value.maskSecrets && !isRevealed.value,
);
const secretLabels = computed(() =>
  [...new Set(props.item.secrets.map(({ label }) => label))].join(", "),
);

// The actions on offer depend on the text: each shows only when it has
// something to do. Items with secrets get none, so they always copy as copied.
const tidied = computed(() => tidyText(text.value));
const formatted = computed(() => formatJson(text.value));
const canTidy = computed(
  () => !hasSecrets.value && tidied.value !== text.value,
);
const canFormat = computed(
  () =>
    !hasSecrets.value &&
    formatted.value !== null &&
    formatted.value !== text.value,
);
// a phone number or an email address in the text, to call or write to
const contact = computed(() =>
  hasSecrets.value ? null : findContact(text.value),
);

// Tidying and formatting only change what's shown here; copying takes what's
// shown
const shownText = computed(() => {
  if (isMasked.value) {
    return maskSecrets(text.value, props.item.secrets)
      .map((part) => part.text)
      .join("");
  }
  if (transform.value === "tidy") return tidied.value;
  if (transform.value === "json") return formatted.value ?? text.value;
  return text.value;
});

function toggleTransform(next: "tidy" | "json"): void {
  transform.value = transform.value === next ? null : next;
}

// the Mac opens these in the mail app, or in FaceTime for a number
function openContact(): void {
  if (contact.value) void tiny.api.call("openLink", { url: contact.value.url });
}

// The text as a QR code, shown in place of the text, to hand it to a phone.
// A long text makes a code too dense for a camera to read.
const qrTextLimit = 500;
const isQrShown = ref(false);
const canShowQr = computed(
  () =>
    !hasSecrets.value &&
    shownText.value.length > 0 &&
    shownText.value.length <= qrTextLimit,
);
const qrCode = computed(() =>
  isQrShown.value && canShowQr.value
    ? renderSVG(shownText.value, { border: 2 })
    : "",
);

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

// Detected once from the copied text; tidying or formatting keeps the language
const language = computedAsync(() => detectCodeLanguage(text.value), null);
const highlightedHtml = computedAsync(
  () =>
    language.value
      ? highlightCode(shownText.value, language.value.id)
      : Promise.resolve(null),
  null,
);

const { isCopied, copy } = usePreviewCopy(() =>
  transform.value ? { text: shownText.value } : getClipboardData(props.item),
);
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="flex min-h-0 flex-1 flex-col gap-2">
      <div class="flex items-center gap-2">
        <ButtonGroup v-if="!hasSecrets">
          <Button
            v-if="canTidy"
            :variant="transform === 'tidy' ? 'secondary' : 'outline'"
            size="sm"
            class="text-xs"
            :aria-pressed="transform === 'tidy'"
            @click="toggleTransform('tidy')">
            <TidyIcon />
            Tidy
          </Button>
          <Button
            v-if="canFormat"
            :variant="transform === 'json' ? 'secondary' : 'outline'"
            size="sm"
            class="text-xs"
            :aria-pressed="transform === 'json'"
            @click="toggleTransform('json')">
            <FormatIcon />
            Format
          </Button>
          <Button
            v-if="canShowQr"
            :variant="isQrShown ? 'secondary' : 'outline'"
            size="sm"
            class="text-xs"
            :aria-pressed="isQrShown"
            @click="isQrShown = !isQrShown">
            <QrIcon />
            QR
          </Button>
          <Button
            v-if="contact"
            variant="outline"
            size="sm"
            class="text-xs"
            @click="openContact">
            <PhoneIcon v-if="contact.kind === 'phone'" />
            <EmailIcon v-else />
            {{ contact.kind === "phone" ? "Call" : "Email" }}
          </Button>
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
        <Tooltip v-if="transform">
          <TooltipTrigger as-child>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Reset text"
              @click="transform = null">
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

      <!-- the QR code takes the text's place; it is always dark on white, so
           a camera reads it in either theme -->
      <div
        v-if="qrCode"
        class="bg-foreground/5 flex min-h-0 flex-1 items-center justify-center rounded-md p-6">
        <div
          class="aspect-square h-full max-h-64 overflow-hidden rounded-lg bg-white [&_svg]:size-full"
          role="img"
          aria-label="QR code of this text"
          v-html="qrCode" />
      </div>
      <ScrollArea
        v-show="!qrCode"
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
