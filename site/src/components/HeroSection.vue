<script setup lang="ts">
import {
  CheckmarkCircle02Icon,
  Download01Icon,
  KeyboardIcon,
  SecurityLockIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/vue";

import appHotkeys from "@/assets/app-hotkeys.webp";
import appPanel from "@/assets/app-panel.webp";
import appSettings from "@/assets/app-settings.webp";
// Photo: engin akyurt on Unsplash (https://unsplash.com/photos/zlGobrmAuyE)
import heroImage from "@/assets/hero-clouds.jpg";
import { Button } from "@/components/ui/button";

const REPO_URL = "https://github.com/theCodeD3vil/teneo";
const DOWNLOAD_URL = `${REPO_URL}/releases/latest`;

// Windows fanned out behind the clipboard panel, each with a feature card
// floating beneath it. left, top and width are percentages of the panel's
// size; the window and its card tilt together, pivoting on a bottom corner.
const fan = [
  {
    src: appSettings,
    alt: "Teneo's General settings, with startup and clipboard options",
    left: -66,
    top: 4,
    width: 112,
    rotate: -10,
    origin: "100% 100%",
    cardSide: "mr-auto",
    side: "left" as const,
    threadSide: "left-2",
    loop: {
      front: [
        "M22 0 C 23 14 11 28 15 50 S 23 86 22 102",
        "M22 0 C 25 14 15 28 21 50 S 25 86 22 102",
      ],
      back: [
        "M22 0 C 19 16 30 32 24 54 S 18 88 22 102",
        "M22 0 C 21 16 34 32 30 54 S 20 88 22 102",
      ],
    },
    // The card swings from its window's hole; the card itself lags a touch.
    sway: {
      "--sway-origin": "30px -78px",
      "--sway-duration": "4.8s",
      "--sway-delay": "-2.1s",
      "--card-origin": "30px 24px",
      "--card-duration": "3.6s",
      "--card-delay": "-0.9s",
    },
    cardColor: "bg-primary text-white",
    iconColor: "bg-white text-primary",
    icon: SecurityLockIcon,
    featureTitle: "Private by design",
    features: [
      "History stays on your Mac",
      "Skips password managers",
      "Masks API keys in history",
    ],
  },
  {
    src: appHotkeys,
    alt: "Teneo's Hotkeys settings, listing the keyboard shortcuts in the panel",
    left: 54,
    top: 4,
    width: 112,
    rotate: 10,
    origin: "0% 100%",
    cardSide: "ml-auto",
    side: "right" as const,
    threadSide: "right-2",
    loop: {
      front: [
        "M22 0 C 18 15 29 30 23 52 S 19 86 22 102",
        "M22 0 C 20 15 33 30 29 52 S 21 86 22 102",
      ],
      back: [
        "M22 0 C 24 14 12 34 16 56 S 24 88 22 102",
        "M22 0 C 26 14 16 34 22 56 S 26 88 22 102",
      ],
    },
    sway: {
      "--sway-origin": "calc(100% - 30px) -78px",
      "--sway-duration": "5.6s",
      "--sway-delay": "-3.9s",
      "--card-origin": "calc(100% - 30px) 24px",
      "--card-duration": "4.2s",
      "--card-delay": "-2.3s",
    },
    cardColor: "bg-warning text-black",
    iconColor: "bg-black text-warning",
    icon: KeyboardIcon,
    featureTitle: "Made for the keyboard",
    features: [
      "Your own shortcut opens it anywhere",
      "⌘ 1–9 copies the first nine items",
      "Press P to pin an item",
    ],
  },
];

// Each card hangs from one cord, looped through a single hole near the bottom
// of its window and a single hole near the top of the card. The holes are real
// cut-outs (a mask), so the page shows through them. Distances are in px, and
// the markup below must match them: the loop sits 30px in from the card's
// outer edge, 22px up from the window's bottom edge and 24px down from the
// card's top edge, across a 56px gap (mt-14).
const HOLE_INSET = 30;
const WINDOW_HOLE_RISE = 22;
const CARD_HOLE_DROP = 24;

type Side = "left" | "right";

function hole(side: Side, radius: number, y: string) {
  const x =
    side === "left" ? `${HOLE_INSET}px` : `calc(100% - ${HOLE_INSET}px)`;
  return {
    "--hole": `radial-gradient(circle ${radius}px at ${x} ${y}, transparent ${radius - 1}px, #000 ${radius}px)`,
  };
}

const windowHole = (side: Side) =>
  hole(side, 8, `calc(100% - ${WINDOW_HOLE_RISE}px)`);
const cardHole = (side: Side) => hole(side, 7, `${CARD_HOLE_DROP}px`);

// Each strand has two shapes that differ only in how far the middle bows to
// one side. Both end at the holes, and the CSS morphs between them.
const cord = (shapes: string[]) => ({
  "--cord-from": `path('${shapes[0]}')`,
  "--cord-to": `path('${shapes[1]}')`,
});
</script>

<template>
  <section
    id="top"
    class="relative flex min-h-svh flex-col items-center overflow-x-clip px-4 pt-32 pb-52 sm:pt-40">
    <div
      class="absolute inset-x-0 top-0 h-svh overflow-hidden [mask-image:linear-gradient(to_bottom,black_50%,transparent)]">
      <img
        :src="heroImage"
        alt=""
        fetchpriority="high"
        class="size-full object-cover" />
    </div>

    <h1
      class="relative max-w-6xl text-center text-5xl leading-[1.05] font-extrabold tracking-tight text-balance text-white drop-shadow-[0_2px_28px_rgb(0_50_130/0.35)] sm:text-6xl lg:text-7xl xl:text-8xl">
      Everything you copy, always within reach.
    </h1>

    <div
      class="relative mt-8 flex w-full max-w-sm flex-col gap-3 sm:w-auto sm:max-w-none sm:flex-row">
      <Button
        as="a"
        :href="DOWNLOAD_URL"
        class="text-primary h-12 rounded-full bg-white px-6 text-base font-semibold hover:bg-white/90">
        <HugeiconsIcon :icon="Download01Icon" class="size-5" />
        Download for Mac
      </Button>
      <Button
        as="a"
        :href="REPO_URL"
        target="_blank"
        rel="noopener noreferrer"
        class="h-12 rounded-full bg-black px-6 text-base font-semibold text-white hover:bg-neutral-800">
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linejoin="round"
          aria-hidden="true"
          class="size-5 text-yellow-400">
          <polygon
            points="12 2.5 14.9 8.9 21.9 9.6 16.6 14.3 18.2 21.2 12 17.6 5.8 21.2 7.4 14.3 2.1 9.6 9.1 8.9" />
        </svg>
        Star on GitHub
      </Button>
    </div>

    <div
      class="relative mt-12 w-(--fan) [--fan:min(78vw,max(20rem,58svh),40rem)] sm:mt-14">
      <div
        v-for="card in fan"
        :key="card.src"
        class="absolute z-10"
        :style="{
          left: `${card.left}%`,
          top: `${card.top}%`,
          width: `${card.width}%`,
          transform: `rotate(${card.rotate}deg)`,
          transformOrigin: card.origin,
        }">
        <img
          :src="card.src"
          :alt="card.alt"
          :style="windowHole(card.side)"
          class="w-full lg:[mask-image:var(--hole)] lg:[-webkit-mask-image:var(--hole)]" />
        <div
          :class="card.cardSide"
          :style="card.sway"
          class="sway relative mt-14 hidden w-[56%] lg:block">
          <span
            aria-hidden="true"
            :class="card.threadSide"
            class="absolute -top-[78px] h-[102px] w-11">
            <svg
              viewBox="0 0 44 102"
              fill="none"
              class="size-full overflow-visible"
              stroke-width="2"
              stroke-linecap="round">
              <!-- The back strand runs behind the window and the card, so it
                   only shows in the gap and through the two holes. -->
              <clipPath :id="`loop-${card.side}`">
                <circle cx="22" cy="0" r="7.5" />
                <rect x="0" y="22" width="44" height="56" />
                <circle cx="22" cy="102" r="6.5" />
              </clipPath>
              <path
                :d="card.loop.back[0]"
                :style="cord(card.loop.back)"
                :clip-path="`url(#loop-${card.side})`"
                class="cord stroke-neutral-800/45" />
            </svg>
          </span>
          <div
            :class="card.cardColor"
            :style="cardHole(card.side)"
            class="sway-card relative z-10 flex min-h-56 flex-col justify-between gap-8 rounded-3xl [mask-image:var(--hole)] p-5 text-left [-webkit-mask-image:var(--hole)]">
            <div>
              <span
                :class="card.iconColor"
                class="grid size-14 place-items-center rounded-2xl">
                <HugeiconsIcon :icon="card.icon" class="size-8" />
              </span>
              <h3 class="mt-3 text-2xl leading-tight font-bold">
                {{ card.featureTitle }}
              </h3>
            </div>
            <ul class="space-y-2">
              <li
                v-for="feature in card.features"
                :key="feature"
                class="flex items-start gap-2 text-sm leading-snug font-medium">
                <HugeiconsIcon
                  :icon="CheckmarkCircle02Icon"
                  class="mt-px size-4 shrink-0" />
                {{ feature }}
              </li>
            </ul>
          </div>
          <span
            aria-hidden="true"
            :class="card.threadSide"
            class="pointer-events-none absolute -top-[78px] z-20 h-[102px] w-11">
            <span
              class="absolute top-0 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.22)]" />
            <span
              class="absolute bottom-0 left-1/2 size-3.5 -translate-x-1/2 translate-y-1/2 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.22)]" />
            <!-- The front strand passes over the window and the card, so
                 unlike the back strand it is never hidden by either. -->
            <svg
              viewBox="0 0 44 102"
              fill="none"
              class="size-full overflow-visible"
              stroke-width="2"
              stroke-linecap="round">
              <path
                :d="card.loop.front[0]"
                :style="cord(card.loop.front)"
                class="cord stroke-neutral-800/75" />
            </svg>
          </span>
        </div>
      </div>
      <img
        :src="appPanel"
        alt="The Teneo panel: a search field, filter tabs and a list of recently copied items"
        class="relative z-20 w-full" />
    </div>
  </section>
</template>

<style scoped>
/* A gentle breeze. Each card swings like a pendulum from the hole in its
   window, and the card itself lags a little behind the thread. The angles are
   tiny, the swings are slow and eased, and the two layers drift out of step. */
.sway {
  transform-origin: var(--sway-origin);
  animation: sway var(--sway-duration) ease-in-out var(--sway-delay) infinite
    alternate;
  /* a mask on the card would clip its own shadow, so the shadow lives here */
  filter: drop-shadow(0 8px 28px rgb(30 80 160 / 0.14));
  will-change: transform;
}

.sway-card {
  transform-origin: var(--card-origin);
  animation: sway-card var(--card-duration) ease-in-out var(--card-delay)
    infinite alternate;
  will-change: transform;
}

@keyframes sway {
  from {
    transform: rotate(-1.6deg);
  }
  to {
    transform: rotate(1.6deg);
  }
}

@keyframes sway-card {
  from {
    transform: rotate(-0.9deg);
  }
  to {
    transform: rotate(0.9deg);
  }
}

/* The cord bows as its card swings. It runs on the card's beat, a quarter
   cycle out of step, so the bow peaks while the card moves fastest. Browsers
   that can't animate `d` in CSS keep the static `d` attribute. */
.cord {
  d: var(--cord-from);
  animation: cord var(--card-duration) ease-in-out
    calc(var(--card-delay) - var(--card-duration) / 2) infinite alternate;
}

@keyframes cord {
  from {
    d: var(--cord-from);
  }
  to {
    d: var(--cord-to);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sway,
  .sway-card,
  .cord {
    animation: none;
  }
}
</style>
