<script setup lang="ts">
import { ref } from "vue";
import AppleIcon from "~icons/ph/apple-logo-fill";
import DownloadIcon from "~icons/ph/download-simple-fill";
import GearIcon from "~icons/ph/gear-fill";
import HandIcon from "~icons/ph/hand-grabbing-fill";
import ShieldIcon from "~icons/ph/shield-check-fill";

import { Button } from "@/components/ui/button";

const DOWNLOAD_URL = "https://github.com/theCodeD3vil/teneo/releases/latest";

const steps = [
  {
    icon: DownloadIcon,
    title: "Download the disk image",
    description:
      "On the latest release, pick the file for your Mac.\nApple Silicon (M1 or later): teneo-<version>-macos-arm64.dmg\nIntel: teneo-<version>-macos-x86_64.dmg",
    note: "Not sure which you have? Open the Apple menu › About This Mac. A Chip line means Apple Silicon, a Processor line means Intel.",
  },
  {
    icon: HandIcon,
    title: "Drag it to Applications",
    description: "Open the disk image and drag Teneo into Applications.",
  },
  {
    icon: ShieldIcon,
    title: "Let macOS open it",
    description:
      "Open Teneo from Applications. macOS blocks it the first time, because Apple hasn't notarized Teneo yet. Click Done, then go to System Settings › Privacy & Security, scroll to the bottom and click Open Anyway next to the message about Teneo. You only need to do this once.",
  },
  {
    icon: GearIcon,
    title: "Go through setup",
    description:
      "A welcome window walks you through setup. Finish it and Teneo is ready to use.",
  },
];

// Hovering a step swaps its number for an icon.
const hovered = ref<number | null>(null);
</script>

<template>
  <!-- White at the top so it joins the Features section without a seam, then
       a growing wash of the primary color toward the bottom of the page. -->
  <section
    id="install"
    class="from-background to-primary/15 flex flex-col items-center bg-linear-to-b px-4 py-24 sm:py-32">
    <h2
      class="max-w-6xl text-center text-5xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl xl:text-8xl">
      Install in four steps.
    </h2>
    <p
      class="text-muted-foreground mt-5 max-w-xl text-center text-base text-balance sm:text-lg">
      Teneo runs on macOS, on both Apple Silicon and Intel Macs.
    </p>
    <Button
      as="a"
      :href="DOWNLOAD_URL"
      class="mt-8 h-12 rounded-full px-6 text-base font-semibold">
      <AppleIcon class="size-5" />
      Download for Mac
    </Button>

    <!-- The cards lean left and right in turn; the wider gap keeps the opposite
         tilts from touching at the corners. -->
    <ol class="mt-16 flex w-full max-w-4xl flex-col gap-8">
      <li
        v-for="(step, i) in steps"
        :key="step.title"
        :class="i % 2 === 0 ? '-rotate-[1.5deg]' : 'rotate-[1.5deg]'"
        class="bg-background flex items-start gap-5 rounded-3xl p-6 shadow-lg shadow-black/5 sm:gap-8 sm:p-8 lg:gap-10 lg:p-10"
        @mouseenter="hovered = i"
        @mouseleave="hovered = null">
        <div
          class="text-primary grid h-15 w-12 shrink-0 items-center justify-items-start *:col-start-1 *:row-start-1 sm:w-14 lg:h-18 lg:w-16">
          <Transition name="morph">
            <component
              :is="step.icon"
              v-if="hovered === i"
              aria-hidden="true"
              class="size-12 lg:size-14" />
            <span
              v-else
              class="text-6xl leading-none font-extrabold lg:text-7xl">
              {{ i + 1 }}
            </span>
          </Transition>
        </div>
        <div>
          <h3 class="text-xl font-medium tracking-tight lg:text-2xl">
            {{ step.title }}
          </h3>
          <p
            class="text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">
            {{ step.description }}
          </p>
          <p
            v-if="step.note"
            class="text-muted-foreground mt-3 text-sm leading-relaxed">
            {{ step.note }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
