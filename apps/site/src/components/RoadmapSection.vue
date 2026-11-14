<script setup lang="ts">
import CheckIcon from "~icons/tabler/circle-check-filled";
import InProgressIcon from "~icons/tabler/circle-half-2";
import BetaIcon from "~icons/tabler/test-pipe";

import { Badge } from "@/components/ui/badge";

type Status = "done" | "in-progress" | "planned";

const statusLabels: Record<Status, string> = {
  done: "Complete",
  "in-progress": "In progress",
  planned: "Planned",
};

// What's built, what's being built, then what's planned (the README's roadmap).
const items: Array<{
  title: string;
  description: string;
  status: Status;
  /** out to try in the app, but still changing */
  beta?: boolean;
}> = [
  {
    title: "Clipboard history",
    description:
      "Text, images, files and colors are saved from the menu bar as you copy, each with the app it came from and when. Pin the ones you want to keep.",
    status: "done",
  },
  {
    title: "Find and paste fast",
    description:
      "Search your history, narrow it by type, and open Teneo from any app with your own shortcut. Paste straight into the app you were using.",
    status: "done",
  },
  {
    title: "Private by default",
    description:
      "Password managers are skipped and API keys are hidden in history, with optional encryption for those keys.",
    status: "done",
  },
  {
    title: "Previews",
    description:
      "Open any item in your history to see it in full, and do more with it than copy and paste.",
    status: "in-progress",
    beta: true,
  },
  {
    title: "Sync engine",
    description:
      "Keep your clipboard history in your own cloud storage instead of only on your Mac (bring your own cloud).",
    status: "planned",
  },
  {
    title: "Android app",
    description:
      "Sync your clipboard history between your Android phone and your Mac.",
    status: "planned",
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
          v-if="item.status === 'done'"
          aria-hidden="true"
          class="text-primary size-7 shrink-0 rounded-full bg-white" />
        <InProgressIcon
          v-else-if="item.status === 'in-progress'"
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
            items[i + 1]?.status === 'done'
              ? 'border-primary'
              : 'border-foreground/25 border-dashed'
          "
          class="absolute top-9 bottom-2 left-[13px] border-l-2" />

        <div>
          <p
            :class="
              item.status === 'planned' ? 'text-foreground/70' : 'text-primary'
            "
            class="text-sm leading-7 font-medium">
            {{ statusLabels[item.status] }}
          </p>
          <h3
            class="flex items-center gap-2 text-xl font-medium tracking-tight lg:text-2xl">
            {{ item.title }}
            <Badge
              v-if="item.beta"
              variant="outline"
              class="text-foreground/70 gap-1 text-xs font-normal tracking-normal">
              <BetaIcon />
              Beta
            </Badge>
          </h3>
          <p class="text-foreground/70 mt-2 leading-relaxed">
            {{ item.description }}
          </p>
        </div>
      </li>
    </ol>
  </section>
</template>
