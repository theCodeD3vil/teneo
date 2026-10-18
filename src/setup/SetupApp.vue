<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { ref, watch } from "vue";
import CheckmarkCircleIcon from "~icons/hugeicons/checkmark-circle-02";
import LinkIcon from "~icons/hugeicons/link-square-02";
import TickIcon from "~icons/hugeicons/tick-02";

import SettingsField from "@/components/settings/SettingsField.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { cn } from "@/lib/utils";

const steps = ["welcome", "permissions", "ready"] as const;
const currentStep = ref<(typeof steps)[number]>("welcome");

const {
  status: accessibilityStatus,
  refresh: refreshAccessibilityStatus,
  request: requestAccessibility,
} = useAccessibilityPermission();

function continueFromWelcome(): void {
  currentStep.value =
    accessibilityStatus.value === "granted" ? "ready" : "permissions";
}

// System Settings doesn't tell Teneo when access is granted, so keep asking
useIntervalFn(() => {
  if (currentStep.value === "permissions") void refreshAccessibilityStatus();
}, 1000);

// Move on once access is granted, after a moment to show that it worked
watch(accessibilityStatus, (status) => {
  if (status !== "granted" || currentStep.value !== "permissions") return;
  setTimeout(() => (currentStep.value = "ready"), 800);
});

const isFinishing = ref(false);

function finishSetup(): void {
  isFinishing.value = true;
  // Closes this window and opens the panel
  void tiny.api.call("finishSetup");
}
</script>

<template>
  <div
    class="flex h-screen flex-col overflow-hidden bg-transparent! px-10 pb-8">
    <!-- the window is frameless: the top strip drags the window -->
    <header data-tiny-drag class="h-10 shrink-0" />

    <Transition
      mode="out-in"
      enter-active-class="animate-in fade-in-0 slide-in-from-right-4 duration-300"
      leave-active-class="animate-out fade-out-0 duration-150">
      <section
        v-if="currentStep === 'welcome'"
        key="welcome"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <img
          data-tiny-drag
          class="mb-2 size-24"
          src="/icon.png"
          alt="Teneo logo" />
        <h1 class="text-2xl font-medium text-balance">
          Everything you copy, always within reach
        </h1>
        <p class="text-foreground/60 max-w-md text-sm text-balance">
          Copy once, find anytime. Teneo keeps track of everything.
        </p>
      </section>

      <section
        v-else-if="currentStep === 'permissions'"
        key="permissions"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Let Teneo paste for you</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          To paste the items you pick into the app you're using, Teneo needs
          Accessibility access.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>Permissions</template>
          <SettingsField>
            <template #label>Accessibility</template>
            <template #description>Needed to paste into other apps</template>
            <span
              v-if="accessibilityStatus === 'granted'"
              class="text-success flex items-center gap-1 text-sm">
              <TickIcon /> Granted
            </span>
            <Button
              v-else-if="accessibilityStatus"
              variant="outline"
              size="sm"
              @click="requestAccessibility">
              Grant access
            </Button>
          </SettingsField>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          Grant access opens System Settings. Turn on Teneo there, then come
          back here.
        </p>
      </section>

      <section
        v-else
        key="ready"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <CheckmarkCircleIcon class="text-success mb-2 size-20" />
        <h1 class="text-2xl font-medium">Teneo is ready</h1>
        <p class="text-foreground/60 max-w-md text-sm text-balance">
          Find Teneo in your menubar at any time.
        </p>
        <!-- after "Set up later" -->
        <p
          v-if="accessibilityStatus !== 'granted'"
          class="text-foreground/60 max-w-md text-xs text-balance">
          Pasting into other apps stays off until you allow Accessibility in
          Settings › Security.
        </p>
      </section>
    </Transition>

    <footer class="flex shrink-0 flex-col items-center gap-y-5">
      <!-- where the user is in the three steps -->
      <div class="flex gap-x-1.5" aria-hidden="true">
        <span
          v-for="step in steps"
          :key="step"
          :class="
            cn(
              'h-1.5 rounded-full transition-all duration-300',
              step === currentStep
                ? 'bg-primary w-4'
                : 'bg-foreground/20 w-1.5',
            )
          " />
      </div>

      <Button
        v-if="currentStep === 'welcome'"
        size="lg"
        class="w-full max-w-xs"
        @click="continueFromWelcome">
        Continue
      </Button>
      <div
        v-else-if="currentStep === 'permissions'"
        class="text-foreground/60 flex h-10 items-center gap-x-2 text-sm">
        <template v-if="accessibilityStatus === 'granted'">
          <TickIcon class="text-success" /> Access granted
        </template>
        <template v-else>
          <Spinner /> Waiting for access
          <span aria-hidden="true">·</span>
          <!-- skips to the last step; Settings › Security grants access later -->
          <Button variant="ghost" size="sm" @click="currentStep = 'ready'">
            Set up later <LinkIcon />
          </Button>
        </template>
      </div>
      <Button
        v-else
        size="lg"
        class="w-full max-w-xs"
        :disabled="isFinishing"
        @click="finishSetup">
        Done
      </Button>
    </footer>
  </div>
</template>
