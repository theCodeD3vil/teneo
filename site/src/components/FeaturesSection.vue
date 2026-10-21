<script setup lang="ts">
import { ref } from "vue";
import ClipboardIcon from "~icons/ph/clipboard-fill";
import PasteIcon from "~icons/ph/clipboard-text-fill";
import DatabaseIcon from "~icons/ph/database-fill";
import KeyIcon from "~icons/ph/key-fill";
import KeyboardIcon from "~icons/ph/keyboard-fill";
import LinkIcon from "~icons/ph/link-fill";
import PasswordIcon from "~icons/ph/lock-key-fill";
import SearchIcon from "~icons/ph/magnifying-glass-fill";

const features = [
  {
    title: "Remembers everything you copy",
    description:
      "Text, images, files and colors are saved as you copy them, each with the app it came from and when.",
    icon: ClipboardIcon,
  },
  {
    title: "Finds it fast",
    description:
      "Search your whole history, or narrow it down with the Files, Image, Color and Text tabs.",
    icon: SearchIcon,
  },
  {
    title: "Works from the keyboard",
    description:
      "Set your own shortcut to open Teneo from any app, then move, copy, pin and delete without touching the mouse.",
    icon: KeyboardIcon,
  },
  {
    title: "Pastes for you",
    description:
      "Paste straight into the app you were using, or turn on Paste on Enter to paste every time you pick an item.",
    icon: PasteIcon,
  },
  {
    title: "Shows where links go",
    description:
      "A link you copy shows its site's icon and name, so you can tell links apart at a glance.",
    icon: LinkIcon,
  },
  {
    title: "Leaves passwords alone",
    description:
      "Anything copied from a password manager is skipped, and you can add any other app you want Teneo to ignore.",
    icon: PasswordIcon,
  },
  {
    title: "Hides API keys",
    description:
      "Keys from GitHub, OpenAI, Stripe, AWS and others are hidden in your history but still paste in full.",
    icon: KeyIcon,
  },
  {
    title: "Keeps only what you want",
    description:
      "Choose how long to keep history, how many items, and how much space it may use. Pinned items always stay.",
    icon: DatabaseIcon,
  },
];

// The count takes the middle of the 3×3 grid, between the fourth and fifth feature.
const cells = [...features.slice(0, 4), null, ...features.slice(4)];

// Hovering a feature swaps the count for its icon, tilted at random on a white
// card in a random theme color (never the same color twice running).
const palette = [
  "var(--primary)",
  "var(--tertiary)",
  "var(--destructive)",
  "var(--success)",
  "var(--info)",
  "var(--warning)",
];
const shown = ref<{
  key: number;
  icon: (typeof features)[number]["icon"];
  color: string;
  tilt: number;
} | null>(null);

function show(i: number) {
  const cell = cells[i];
  if (!cell) {
    shown.value = null;
  } else if (shown.value?.key !== i) {
    const colors = palette.filter((color) => color !== shown.value?.color);
    shown.value = {
      key: i,
      icon: cell.icon,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      tilt: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 10),
    };
  }
}

// Dashed rules only between cells, never along the grid's outer edges. The grid
// is one column on mobile, two on md and three on lg; below lg the count is
// hidden, so on md the cells after it move up one place.
const cellClass = (i: number) => {
  const place = i > 4 ? i - 1 : i;
  return [
    i < 8 && "max-md:border-b",
    place < 6 && "md:max-lg:border-b",
    place % 2 === 0 && "md:max-lg:border-r",
    i < 6 && "lg:border-b",
    i % 3 < 2 && "lg:border-r",
    i === 4 ? "max-lg:hidden" : "hover:bg-muted/70",
  ];
};
</script>

<template>
  <section id="features" class="flex flex-col items-center px-4 py-24 sm:py-32">
    <h2
      class="max-w-6xl text-center text-5xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-6xl lg:text-7xl xl:text-8xl">
      Everything a clipboard needs.
    </h2>
    <p
      class="text-muted-foreground mt-5 max-w-xl text-center text-base text-balance sm:text-lg">
      Everything Teneo does to keep your clipboard quick, useful and private.
    </p>

    <div
      class="mt-16 grid w-full max-w-7xl grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
      @mouseleave="shown = null">
      <div
        v-for="(cell, i) in cells"
        :key="i"
        :class="cellClass(i)"
        class="border-foreground/12 relative flex flex-col border-dashed p-6 transition-colors duration-300 sm:p-8 lg:min-h-60 lg:p-10"
        @mouseenter="show(i)">
        <template v-if="cell">
          <h3 class="text-xl font-medium tracking-tight lg:text-2xl">
            {{ cell.title }}
          </h3>
          <p class="text-muted-foreground mt-3 leading-relaxed">
            {{ cell.description }}
          </p>
        </template>
        <div
          v-else
          aria-hidden="true"
          class="absolute inset-0 grid place-items-center *:col-start-1 *:row-start-1">
          <Transition name="morph">
            <div
              v-if="shown"
              :key="shown.key"
              :style="{ rotate: `${shown.tilt}deg`, color: shown.color }"
              class="ring-foreground/5 shadow-foreground/10 grid size-32 place-items-center rounded-4xl bg-white shadow-xl ring-1">
              <component :is="shown.icon" class="size-16" />
            </div>
            <span
              v-else
              class="text-primary text-8xl leading-none font-extrabold lg:text-[10rem]">
              {{ features.length }}
            </span>
          </Transition>
        </div>
      </div>
    </div>
  </section>
</template>
