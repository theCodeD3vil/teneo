<script setup lang="ts">
import { Badge } from "@teneo/ui/components/badge";
import { Button } from "@teneo/ui/components/button";
import { ref } from "vue";

const showDetails = ref(false);
</script>

<template>
  <main class="safe-area mx-auto flex min-h-dvh max-w-lg flex-col">
    <header class="flex items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <span
          class="bg-primary flex size-10 items-center justify-center rounded-xl text-white"
          aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" class="size-6">
            <rect
              x="6"
              y="5"
              width="12"
              height="15"
              rx="3"
              stroke="currentColor"
              stroke-width="1.8" />
            <path
              d="M9 5.5V4.7A1.7 1.7 0 0 1 10.7 3h2.6A1.7 1.7 0 0 1 15 4.7v.8"
              stroke="currentColor"
              stroke-width="1.8" />
            <path
              d="M9.5 10h5M9.5 13.5h5"
              stroke="currentColor"
              stroke-linecap="round"
              stroke-width="1.8" />
          </svg>
        </span>
        <span class="text-lg font-bold tracking-tight">Teneo</span>
      </div>
      <Badge variant="secondary">In development</Badge>
    </header>

    <section
      class="flex flex-1 flex-col justify-center py-16"
      aria-labelledby="welcome-heading">
      <p
        class="text-primary mb-4 text-sm font-semibold tracking-wide uppercase">
        A little more room to remember
      </p>
      <h1
        id="welcome-heading"
        class="text-foreground text-4xl leading-[1.1] font-bold tracking-tight sm:text-5xl">
        Everything you copy, within reach.
      </h1>
      <p class="text-muted-foreground mt-5 max-w-sm text-base leading-7">
        Teneo is coming to Android. Your clipboard history will feel right at
        home here.
      </p>
      <div class="mt-8">
        <Button
          class="min-h-12 px-5"
          :aria-expanded="showDetails"
          aria-controls="details"
          @click="showDetails = !showDetails">
          {{ showDetails ? "Hide details" : "What’s coming" }}
        </Button>
      </div>
      <div
        v-if="showDetails"
        id="details"
        class="bg-muted text-muted-foreground mt-5 rounded-2xl p-5 text-sm leading-6">
        Search and pin text, copy it again, and pair with your Mac. This screen
        is a preview; nothing is saved or synced yet.
      </div>
    </section>

    <footer class="text-muted-foreground border-border border-t pt-5 text-sm">
      Built for the things worth keeping.
    </footer>
  </main>
</template>
