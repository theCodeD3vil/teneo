<script setup lang="ts">
import CheckIcon from "~icons/tabler/circle-check-filled";

// What's built first, then what's planned (the README's roadmap).
const items = [
  {
    title: "Clipboard history",
    description:
      "Text, images, files and colors are saved from the menu bar as you copy, each with the app it came from and when. Pin the ones you want to keep.",
    done: true,
  },
  {
    title: "Find and paste fast",
    description:
      "Search your history, narrow it by type, and open Teneo from any app with your own shortcut. Paste straight into the app you were using.",
    done: true,
  },
  {
    title: "Private by default",
    description:
      "Password managers are skipped and API keys are hidden in history, with optional encryption for those keys.",
    done: true,
  },
  {
    title: "Previews",
    description:
      "Open any item in your history to see it in full, and do more with it than copy and paste.",
    done: false,
  },
  {
    title: "Sync engine",
    description:
      "Keep your clipboard history in your own cloud storage instead of only on your Mac (bring your own cloud).",
    done: false,
  },
  {
    title: "Android app",
    description:
      "Sync your clipboard history between your Android phone and your Mac.",
    done: false,
  },
];
</script>

<template>
  <!-- Starts as the tint the Install section's gradient ends on, then fades to white. -->
  <section
    id="roadmap"
    class="from-primary/15 to-background flex flex-col items-center bg-linear-to-b to-40% px-4 py-24 sm:py-32">
    <h2
      class="max-w-6xl text-center text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl lg:text-6xl">
      Roadmap
    </h2>
    <p
      class="text-foreground/70 mt-5 max-w-xl text-center text-base text-balance sm:text-lg">
      Here's what's done and what's planned next. More will be added over time.
    </p>

    <!-- A solid line runs through what's done and a dashed one on to what's planned. -->
    <ol class="mt-16 w-full max-w-3xl">
      <li
        v-for="(item, i) in items"
        :key="item.title"
        class="relative flex gap-5 pb-12 last:pb-0 sm:gap-6">
        <CheckIcon
          v-if="item.done"
          aria-hidden="true"
          class="text-primary size-7 shrink-0 rounded-full bg-white" />
        <span
          v-else
          aria-hidden="true"
          class="border-primary/60 size-7 shrink-0 rounded-full border-2 border-dashed bg-white" />
        <span
          v-if="i < items.length - 1"
          aria-hidden="true"
          :class="
            items[i + 1]?.done
              ? 'border-primary'
              : 'border-foreground/25 border-dashed'
          "
          class="absolute top-9 bottom-2 left-[13px] border-l-2" />

        <div>
          <p
            :class="item.done ? 'text-primary' : 'text-foreground/70'"
            class="text-sm leading-7 font-medium">
            {{ item.done ? "Complete" : "Planned" }}
          </p>
          <h3 class="text-xl font-medium tracking-tight lg:text-2xl">
            {{ item.title }}
          </h3>
          <p class="text-foreground/70 mt-2 leading-relaxed">
            {{ item.description }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
