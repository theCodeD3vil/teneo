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
</script>

<template>
  <section
    id="top"
    class="relative flex min-h-svh flex-col items-center overflow-x-clip px-4 pt-32 pb-44 sm:pt-40">
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
        <img :src="card.src" :alt="card.alt" class="w-full" />
        <div
          :class="[card.cardSide, card.cardColor]"
          class="mt-5 hidden min-h-56 w-[56%] flex-col justify-between gap-8 rounded-3xl p-5 text-left shadow-[0_8px_28px_rgb(30_80_160/0.14)] lg:flex">
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
      </div>
      <img
        :src="appPanel"
        alt="The Teneo panel: a search field, filter tabs and a list of recently copied items"
        class="relative z-20 w-full" />
    </div>
  </section>
</template>
