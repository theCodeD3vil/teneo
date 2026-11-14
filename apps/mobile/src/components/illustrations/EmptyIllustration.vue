<!-- What an empty or failed list shows, drawn for what's missing: a bare
     clipboard, a blank page, an empty frame, an empty folder, blank swatches,
     a search that found nothing, or a clipboard that wouldn't load. Each
     draws itself in when it appears (see .illus-* in style.css). -->
<script setup lang="ts">
import type { TabVariant } from "../../types/tabs";
import { sparkle } from "./sparkle";

defineProps<{
  kind: TabVariant | "search" | "error";
}>();

function delay(milliseconds: number) {
  return { "--illus-delay": `${milliseconds}ms` };
}

// fanned out from a rivet near the bottom, left to right
const swatches = [
  { angle: -20, color: "fill-tertiary/80" },
  { angle: 0, color: "fill-warning/80" },
  { angle: 20, color: "fill-primary/80" },
];
</script>

<template>
  <!-- keyed, so a new tab's drawing plays its intro from the start -->
  <svg :key="kind" viewBox="0 0 160 120" fill="none" aria-hidden="true">
    <ellipse
      cx="80"
      cy="66"
      rx="70"
      ry="44"
      class="illus-swell fill-foreground/5" />

    <!-- every copy: a clipboard with nothing on it -->
    <template v-if="kind === 'all' || kind === 'error'">
      <g class="illus-rise" :style="delay(80)">
        <rect
          x="50"
          y="24"
          width="60"
          height="78"
          rx="8"
          stroke-width="2"
          class="fill-background stroke-foreground/20" />
        <rect
          x="64"
          y="17"
          width="32"
          height="14"
          rx="5"
          :class="
            kind === 'error' ? 'fill-foreground/25' : 'fill-primary/70'
          " />
        <rect
          x="60"
          y="44"
          width="40"
          height="6"
          rx="3"
          class="fill-foreground/10" />
        <rect
          x="60"
          y="56"
          width="30"
          height="6"
          rx="3"
          class="fill-foreground/10" />
        <rect
          x="60"
          y="68"
          width="35"
          height="6"
          rx="3"
          class="fill-foreground/10" />
        <rect
          x="60"
          y="80"
          width="22"
          height="6"
          rx="3"
          class="fill-foreground/10" />
      </g>
      <template v-if="kind === 'all'">
        <g class="illus-rise" :style="delay(240)">
          <rect
            x="104"
            y="58"
            width="36"
            height="24"
            rx="5"
            transform="rotate(10 122 70)"
            stroke-width="1.5"
            stroke-dasharray="4 4"
            class="fill-background stroke-primary/50" />
        </g>
        <g class="illus-pop" :style="delay(380)">
          <path
            :d="sparkle"
            transform="translate(34 40) scale(.7)"
            class="fill-primary/50" />
        </g>
        <circle
          cx="128"
          cy="36"
          r="2.5"
          class="illus-pop fill-primary/30"
          :style="delay(460)" />
      </template>
      <template v-else>
        <g class="illus-pop" :style="delay(260)">
          <rect
            x="112"
            y="38"
            width="16"
            height="5"
            rx="2.5"
            transform="rotate(25 120 40.5)"
            class="fill-foreground/15" />
        </g>
        <g class="illus-pop" :style="delay(320)">
          <rect
            x="30"
            y="52"
            width="12"
            height="5"
            rx="2.5"
            transform="rotate(-20 36 54.5)"
            class="fill-foreground/15" />
        </g>
        <g class="illus-pop" :style="delay(400)">
          <circle
            cx="108"
            cy="86"
            r="16"
            stroke-width="4"
            class="fill-destructive stroke-background" />
          <rect
            x="106.25"
            y="77"
            width="3.5"
            height="11"
            rx="1.75"
            class="fill-white" />
          <circle cx="108" cy="93.5" r="2" class="fill-white" />
        </g>
      </template>
    </template>

    <!-- text: a blank page, the cursor waiting -->
    <template v-else-if="kind === 'text'">
      <g class="illus-rise" :style="delay(80)">
        <path
          d="M56 22h34l16 16v56a6 6 0 0 1-6 6H56a6 6 0 0 1-6-6V28a6 6 0 0 1 6-6Z"
          stroke-width="2"
          class="fill-background stroke-foreground/20" />
        <path
          d="M90 22v10a6 6 0 0 0 6 6h10"
          stroke-width="2"
          stroke-linejoin="round"
          class="stroke-foreground/20" />
      </g>
      <rect
        x="60"
        y="48"
        width="34"
        height="5"
        rx="2.5"
        class="illus-rise fill-success/60"
        :style="delay(200)" />
      <rect
        x="60"
        y="60"
        width="40"
        height="5"
        rx="2.5"
        class="illus-rise fill-foreground/12"
        :style="delay(260)" />
      <rect
        x="60"
        y="72"
        width="26"
        height="5"
        rx="2.5"
        class="illus-rise fill-foreground/12"
        :style="delay(320)" />
      <g class="illus-pop" :style="delay(380)">
        <rect
          x="89"
          y="70"
          width="2.5"
          height="9"
          rx="1.25"
          class="fill-success motion-safe:animate-pulse" />
      </g>
      <g class="illus-pop" :style="delay(440)">
        <circle
          cx="110"
          cy="90"
          r="14"
          stroke-width="3"
          class="fill-success/20 stroke-background" />
        <text
          x="110"
          y="95"
          text-anchor="middle"
          class="fill-success text-[13px] font-medium">
          Aa
        </text>
      </g>
      <g class="illus-pop" :style="delay(520)">
        <path
          :d="sparkle"
          transform="translate(36 38) scale(.7)"
          class="fill-success/50" />
      </g>
    </template>

    <!-- images: an empty frame over another -->
    <template v-else-if="kind === 'image'">
      <g class="illus-rise" :style="delay(80)">
        <rect
          x="40"
          y="32"
          width="64"
          height="50"
          rx="6"
          transform="rotate(-8 72 57)"
          stroke-width="2"
          class="fill-primary/10 stroke-foreground/15" />
      </g>
      <g class="illus-rise" :style="delay(180)">
        <rect
          x="56"
          y="40"
          width="68"
          height="54"
          rx="6"
          stroke-width="2"
          class="fill-background stroke-foreground/20" />
        <rect
          x="62"
          y="46"
          width="56"
          height="42"
          rx="2"
          class="fill-info/15" />
      </g>
      <path
        d="M62 88 78 64l16 24Z"
        class="illus-rise fill-primary/35"
        :style="delay(300)" />
      <path
        d="m80 88 19-20 19 18v2Z"
        class="illus-rise fill-primary/60"
        :style="delay(360)" />
      <circle
        cx="106"
        cy="57"
        r="5"
        class="illus-pop fill-warning"
        :style="delay(440)" />
      <g class="illus-pop" :style="delay(500)">
        <path
          :d="sparkle"
          transform="translate(132 34) scale(.7)"
          class="fill-warning/70" />
      </g>
      <circle
        cx="34"
        cy="80"
        r="2.5"
        class="illus-pop fill-primary/30"
        :style="delay(560)" />
    </template>

    <!-- files: an open folder holding a single blank sheet -->
    <template v-else-if="kind === 'files'">
      <path
        d="M42 36a6 6 0 0 1 6-6h20l8 8h36a6 6 0 0 1 6 6v46a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6Z"
        class="illus-rise fill-warning/45"
        :style="delay(80)" />
      <!-- the sheet slides up out of the folder -->
      <g class="illus-rise" :style="delay(220)">
        <g transform="rotate(-6 78 50)">
          <rect
            x="54"
            y="30"
            width="48"
            height="40"
            rx="4"
            stroke-width="1.5"
            class="fill-background stroke-foreground/15" />
          <rect
            x="60"
            y="38"
            width="26"
            height="4"
            rx="2"
            class="fill-foreground/12" />
          <rect
            x="60"
            y="46"
            width="34"
            height="4"
            rx="2"
            class="fill-foreground/12" />
        </g>
      </g>
      <path
        d="M42 54a6 6 0 0 1 6-6h64a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H48a6 6 0 0 1-6-6Z"
        class="illus-rise fill-warning"
        :style="delay(140)" />
      <g class="illus-pop" :style="delay(400)">
        <path
          :d="sparkle"
          transform="translate(130 34) scale(.7)"
          class="fill-warning" />
      </g>
      <circle
        cx="32"
        cy="50"
        r="2.5"
        class="illus-pop fill-warning/50"
        :style="delay(480)" />
    </template>

    <!-- colors: swatch cards, stacked, fanning out -->
    <template v-else-if="kind === 'color'">
      <g
        v-for="(swatch, index) in swatches"
        :key="swatch.angle"
        class="illus-fan"
        :style="{
          ...delay(120 + index * 60),
          '--fan-from': `${-swatch.angle}deg`,
        }">
        <g :transform="`rotate(${swatch.angle} 80 98)`">
          <rect
            x="66"
            y="42"
            width="28"
            height="56"
            rx="5"
            stroke-width="1.5"
            class="fill-background stroke-foreground/15" />
          <path
            d="M66 47a5 5 0 0 1 5-5h18a5 5 0 0 1 5 5v25H66Z"
            :class="swatch.color" />
          <rect
            x="71"
            y="78"
            width="14"
            height="3"
            rx="1.5"
            class="fill-foreground/20" />
          <rect
            x="71"
            y="84"
            width="9"
            height="3"
            rx="1.5"
            class="fill-foreground/12" />
        </g>
      </g>
      <circle
        cx="80"
        cy="93"
        r="2.5"
        class="illus-pop fill-foreground/25"
        :style="delay(300)" />
      <g class="illus-pop" :style="delay(500)">
        <path
          :d="sparkle"
          transform="translate(126 30) scale(.7)"
          class="fill-tertiary/70" />
      </g>
      <circle
        cx="36"
        cy="38"
        r="2.5"
        class="illus-pop fill-primary/30"
        :style="delay(560)" />
    </template>

    <!-- search: the glass over cards, finding none of them -->
    <template v-else>
      <g class="illus-rise" :style="delay(80)">
        <rect
          x="34"
          y="36"
          width="68"
          height="20"
          rx="5"
          class="fill-background stroke-foreground/10" />
        <rect
          x="40"
          y="43"
          width="7"
          height="7"
          rx="2"
          class="fill-foreground/10" />
        <rect
          x="51"
          y="44"
          width="30"
          height="4"
          rx="2"
          class="fill-foreground/10" />
      </g>
      <g class="illus-rise" :style="delay(160)">
        <rect
          x="34"
          y="62"
          width="68"
          height="20"
          rx="5"
          class="fill-background stroke-foreground/10" />
        <rect
          x="40"
          y="69"
          width="7"
          height="7"
          rx="2"
          class="fill-foreground/10" />
        <rect
          x="51"
          y="70"
          width="22"
          height="4"
          rx="2"
          class="fill-foreground/10" />
      </g>
      <!-- the glass swings in and settles over the cards -->
      <g class="illus-search" :style="delay(260)">
        <path
          d="m107 75 17 17"
          stroke-width="8"
          stroke-linecap="round"
          class="stroke-primary/70" />
        <circle
          cx="92"
          cy="58"
          r="22"
          stroke-width="5"
          class="fill-background/85 stroke-primary/70" />
        <text
          x="92"
          y="66"
          text-anchor="middle"
          class="fill-primary/70 text-[22px] font-medium">
          ?
        </text>
      </g>
      <g class="illus-pop" :style="delay(560)">
        <path
          :d="sparkle"
          transform="translate(130 32) scale(.6)"
          class="fill-primary/50" />
      </g>
    </template>
  </svg>
</template>
