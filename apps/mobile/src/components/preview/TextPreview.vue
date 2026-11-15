<script setup lang="ts">
import { useVirtualizer } from "@tanstack/vue-virtual";
import type { ClipboardHistoryItem } from "@teneo/shared/types/clipboard";
import { detectCodeLanguage, highlightCode } from "@teneo/ui/utils/highlight";
import { maskSecrets } from "@teneo/ui/utils/secrets";
import {
  findContact,
  formatJson,
  tidyText,
} from "@teneo/ui/utils/text-actions";
import { computedAsync } from "@vueuse/core";
import { renderSVG } from "uqr";
import { type ComponentPublicInstance, computed, ref, watch } from "vue";
import FormatIcon from "~icons/tabler/braces";
import RevealIcon from "~icons/tabler/eye";
import ConcealIcon from "~icons/tabler/eye-off";
import EmailIcon from "~icons/tabler/mail";
import PhoneIcon from "~icons/tabler/phone";
import QrIcon from "~icons/tabler/qrcode";
import ResetIcon from "~icons/tabler/restore";
import TidyIcon from "~icons/tabler/wand";

import { useSettings } from "../../composables/useSettings";
import BottomSheet from "../BottomSheet.vue";

const props = defineProps<{
  item: ClipboardHistoryItem;
}>();

/** the shown text after tidying or formatting, for the Copy button; null
 *  when it is shown as copied */
const convertedText = defineModel<string | null>("convertedText", {
  default: null,
});

const { settings } = useSettings();
// how the text is shown: as copied, tidied, or laid out as JSON
const transform = ref<"tidy" | "json" | null>(null);
const isRevealed = ref(false);

const text = computed(() => props.item.text ?? "");
const hasSecrets = computed(() => props.item.secrets.length > 0);
const isMasked = computed(
  () => hasSecrets.value && settings.value.hideSecrets && !isRevealed.value,
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

// Tidying and formatting only change what's shown here; Copy takes what's shown
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

watch(
  [transform, shownText],
  () => (convertedText.value = transform.value ? shownText.value : null),
  { immediate: true },
);

function toggleTransform(next: "tidy" | "json"): void {
  transform.value = transform.value === next ? null : next;
}

// Capacitor hands these to the phone's dialler or mail app
function openContact(): void {
  if (contact.value) window.location.href = contact.value.url;
}

// The text as a QR code, to hand it to another phone. A long text makes a
// code too dense for a camera to read.
const qrTextLimit = 500;
const isQrOpen = ref(false);
const canShowQr = computed(
  () =>
    !hasSecrets.value &&
    shownText.value.length > 0 &&
    shownText.value.length <= qrTextLimit,
);
const qrCode = computed(() =>
  isQrOpen.value ? renderSVG(shownText.value, { border: 2 }) : "",
);

const hasActions = computed(
  () =>
    canTidy.value ||
    canFormat.value ||
    canShowQr.value ||
    Boolean(contact.value),
);
const actionClass =
  "flex h-[2.5rem] items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold transition-colors [&_svg]:size-[1.125rem]";
const activeActionClass = "bg-cta text-cta-foreground";

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

// Detected once from the copied text; tidying or formatting keeps the language
const language = computedAsync(() => detectCodeLanguage(text.value), null);
const highlightedHtml = computedAsync(
  () =>
    language.value
      ? highlightCode(shownText.value, language.value.id)
      : Promise.resolve(null),
  null,
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-4">
    <!-- the text's actions sit in the screen's top bar, beside the back button:
         placed against the screen, over the bar's free end -->
    <div
      class="absolute top-0 right-0 left-[3.625rem] flex h-[3rem] items-center justify-end gap-2">
      <div
        v-if="!hasSecrets && hasActions"
        class="bg-card flex shrink-0 rounded-full p-[3px]">
        <button
          v-if="canTidy"
          type="button"
          :class="[actionClass, transform === 'tidy' && activeActionClass]"
          :aria-pressed="transform === 'tidy'"
          @click="toggleTransform('tidy')">
          <TidyIcon />
          Tidy
        </button>
        <button
          v-if="canFormat"
          type="button"
          :class="[actionClass, transform === 'json' && activeActionClass]"
          :aria-pressed="transform === 'json'"
          @click="toggleTransform('json')">
          <FormatIcon />
          Format
        </button>
        <button
          v-if="canShowQr"
          type="button"
          :class="actionClass"
          @click="isQrOpen = true">
          <QrIcon />
          QR
        </button>
        <button
          v-if="contact"
          type="button"
          :class="actionClass"
          @click="openContact">
          <PhoneIcon v-if="contact.kind === 'phone'" />
          <EmailIcon v-else />
          {{ contact.kind === "phone" ? "Call" : "Email" }}
        </button>
      </div>
      <template v-else-if="settings.hideSecrets">
        <button
          type="button"
          class="pill-button border-transparent"
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
           actions slide over instead of jumping -->
      <Transition name="reset-button">
        <button
          v-if="transform"
          type="button"
          class="text-muted-foreground active:bg-muted grid h-[2.75rem] w-[2.75rem] shrink-0 place-items-center overflow-hidden rounded-full"
          aria-label="Reset text"
          @click="transform = null">
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
    <BottomSheet
      v-model:open="isQrOpen"
      title="QR code"
      description="Scan it with another phone's camera to get this text.">
      <!-- always dark on white, so a camera reads it in either theme -->
      <div
        class="mx-auto aspect-square w-full max-w-[18rem] overflow-hidden rounded-[1.5rem] bg-white [&_svg]:size-full"
        role="img"
        aria-label="QR code of this text"
        v-html="qrCode" />
    </BottomSheet>
    <p v-if="isCapped" class="text-muted-foreground text-xs">
      Showing the first {{ previewTextLimit.toLocaleString() }} of
      {{ shownText.length.toLocaleString() }} characters. Copy takes all of it.
    </p>
  </div>
</template>
