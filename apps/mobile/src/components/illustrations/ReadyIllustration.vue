<!-- a phone full of clipboard items, checked off: setup is done -->
<script setup lang="ts">
import { sparkle } from "./sparkle";

const cards = [
  { y: 28, icon: "fill-success/40", line: 13 },
  { y: 52, icon: "fill-primary/40", line: 16 },
  { y: 76, icon: "fill-warning/50", line: 10 },
  { y: 100, icon: "fill-tertiary/40", line: 14 },
];

const sparkles = [
  { at: "translate(48 34)", color: "fill-warning" },
  { at: "translate(156 30) scale(.8)", color: "fill-primary/60" },
  { at: "translate(42 98) scale(.6)", color: "fill-success/70" },
];
</script>

<template>
  <svg viewBox="0 0 200 140" fill="none" aria-hidden="true">
    <ellipse
      cx="100"
      cy="80"
      rx="90"
      ry="52"
      class="illus-swell fill-success/10" />

    <g class="illus-rise" style="--illus-delay: 80ms">
      <rect
        x="68"
        y="12"
        width="64"
        height="118"
        rx="11"
        stroke-width="2"
        class="fill-background stroke-foreground/20" />
      <rect
        x="74"
        y="20"
        width="52"
        height="102"
        rx="6"
        class="fill-foreground/4" />
    </g>
    <!-- the items land one after another -->
    <g
      v-for="(card, index) in cards"
      :key="index"
      class="illus-rise"
      :style="{ '--illus-delay': `${200 + index * 80}ms` }">
      <rect
        x="79"
        :y="card.y"
        width="42"
        height="20"
        rx="4"
        class="fill-background stroke-foreground/10" />
      <rect
        x="83"
        :y="card.y + 6"
        width="8"
        height="8"
        rx="2"
        :class="card.icon" />
      <rect
        x="95"
        :y="card.y + 6"
        width="20"
        height="3"
        rx="1.5"
        class="fill-foreground/25" />
      <rect
        x="95"
        :y="card.y + 12"
        :width="card.line"
        height="3"
        rx="1.5"
        class="fill-foreground/12" />
    </g>

    <g class="illus-pop" style="--illus-delay: 560ms">
      <circle
        cx="132"
        cy="104"
        r="17"
        stroke-width="4"
        class="fill-success stroke-background" />
      <path
        d="m124 104.5 5.5 5.5 11-11.5"
        stroke-width="3.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="stroke-white" />
    </g>

    <g
      v-for="(star, index) in sparkles"
      :key="star.at"
      class="illus-pop"
      :style="{ '--illus-delay': `${660 + index * 70}ms` }">
      <path :d="sparkle" :transform="star.at" :class="star.color" />
    </g>
    <circle
      cx="160"
      cy="66"
      r="2.5"
      class="illus-pop fill-warning/60"
      style="--illus-delay: 840ms" />
    <circle
      cx="34"
      cy="64"
      r="2"
      class="illus-pop fill-primary/40"
      style="--illus-delay: 900ms" />
  </svg>
</template>
