<script setup lang="ts">
import { computed } from "vue";
import AlertCircleIcon from "~icons/tabler/alert-circle";

import SettingsTabManager from "@/components/settings/SettingsTabManager.vue";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";

// Shown on every tab while setup is unfinished, e.g. after "Set up later"
const { status: accessibilityStatus } = useAccessibilityPermission();
const isSetupUnfinished = computed(
  () =>
    accessibilityStatus.value === "denied" ||
    accessibilityStatus.value === "undetermined",
);

function openSetup(): void {
  void tiny.api.call("openSetup");
}
</script>

<template>
  <div
    class="flex h-screen flex-col overflow-hidden bg-transparent! px-4 pb-4 dark:bg-black/55!">
    <!-- the window is frameless: the top strip and logo row drag the window -->
    <header data-tiny-drag class="h-3 shrink-0" />
    <div
      data-tiny-drag
      class="mb-8 flex w-full items-center justify-center gap-x-2">
      <img class="aspect-square size-8" src="/icon.png" alt="Teneo Icon" />
      <span class="text-lg font-medium">Teneo</span>
    </div>
    <SettingsTabManager>
      <Alert
        v-if="isSetupUnfinished"
        class="border-warning/30 bg-warning/10 dark:bg-warning/15 mx-auto mt-4 max-w-xl shrink-0 has-data-[slot=alert-action]:pr-36">
        <AlertCircleIcon class="text-warning!" />
        <AlertTitle>Finish setting up Teneo</AlertTitle>
        <AlertDescription class="text-foreground/60 text-xs">
          Teneo can't paste into other apps until you allow Accessibility.
        </AlertDescription>
        <AlertAction class="top-1/2 -translate-y-1/2">
          <Button size="sm" @click="openSetup"> Finish setup </Button>
        </AlertAction>
      </Alert>
    </SettingsTabManager>
  </div>
</template>
