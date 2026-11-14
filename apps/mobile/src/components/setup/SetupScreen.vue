<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { cn } from "@teneo/ui/lib/utils";
import { computed, ref } from "vue";
import TickIcon from "~icons/tabler/check";
import CheckmarkCircleIcon from "~icons/tabler/circle-check";

import logoUrl from "../../assets/logo.svg";
import { useNavigation } from "../../composables/useNavigation";
import { useSettings } from "../../composables/useSettings";
import { markSetupDone } from "../../composables/useSetup";
import { useSyncStatus } from "../../composables/useSyncStatus";
import SettingsField from "../settings/SettingsField.vue";
import SettingsSection from "../settings/SettingsSection.vue";

const steps = ["welcome", "sync", "ready"] as const;
const currentStep = ref<(typeof steps)[number]>("welcome");

const { currentState, goBack, replaceScreen } = useNavigation();
const { status, isBusy, error, join } = useSyncStatus();
const { settings, updateSettings } = useSettings();

const isSyncOn = computed(
  () =>
    status.value !== null &&
    status.value.state !== "off" &&
    status.value.state !== "not_paired",
);

const recoveryCode = ref("");
const joinedDeviceName = ref<string | null>(null);

async function joinWithCode(): Promise<void> {
  const deviceName = await join(recoveryCode.value);
  if (!deviceName) return;
  joinedDeviceName.value = deviceName;
  recoveryCode.value = "";
  currentStep.value = "ready";
}

const captureOnOpen = computed({
  get: () => settings.value.captureOnOpen,
  set: (enabled) => updateSettings({ captureOnOpen: enabled }),
});

// First run replaces itself with the history; opened from Settings, it goes back
function finishSetup(): void {
  markSetupDone();
  if (currentState.value.index > 0) goBack();
  else replaceScreen("history");
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col px-2">
    <Transition
      mode="out-in"
      enter-active-class="animate-in fade-in-0 slide-in-from-right-4 duration-300"
      leave-active-class="animate-out fade-out-0 duration-150">
      <section
        v-if="currentStep === 'welcome'"
        key="welcome"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <img class="mb-2 size-24" :src="logoUrl" alt="Teneo logo" />
        <h1 class="text-2xl font-medium text-balance">
          Everything you copy, always within reach
        </h1>
        <p class="text-foreground/60 max-w-md text-sm text-balance">
          Copy on your Mac, find it on your phone. Teneo keeps track of
          everything.
        </p>
      </section>

      <section
        v-else-if="currentStep === 'sync'"
        key="sync"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 overflow-y-auto text-center">
        <h1 class="text-2xl font-medium text-balance">Connect to your Mac</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          On your Mac, open Teneo's Settings › Sync and choose Add a device.
          Type the recovery code it shows.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>Sync</template>
          <SettingsField v-if="isSyncOn">
            <template #label>Sync is on</template>
            <template #description>This phone already syncs</template>
            <span class="text-success flex items-center gap-1 text-sm">
              <TickIcon /> Joined
            </span>
          </SettingsField>
          <SettingsField v-else>
            <template #label>Recovery code</template>
            <template #description
              >Shown under the QR code on your Mac</template
            >
            <template #footer>
              <form @submit.prevent="joinWithCode">
                <Input
                  v-model="recoveryCode"
                  placeholder="XXXX-XXXX-XXXX"
                  autocomplete="off"
                  autocapitalize="characters"
                  spellcheck="false"
                  enterkeyhint="go"
                  class="font-mono" />
              </form>
            </template>
          </SettingsField>
        </SettingsSection>
        <p v-if="error" class="text-destructive text-xs text-balance">
          {{ error }}
        </p>
        <p v-else class="text-foreground/60 text-xs text-balance">
          Your history syncs over Wi-Fi, encrypted, with no account or server.
        </p>
      </section>

      <section
        v-else
        key="ready"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <CheckmarkCircleIcon class="text-success mb-2 size-20" />
        <h1 class="text-2xl font-medium">Teneo is ready</h1>
        <p
          v-if="joinedDeviceName || isSyncOn"
          class="text-foreground/60 max-w-md text-sm text-balance">
          Connected to {{ joinedDeviceName ?? "your Mac" }}. What you copy there
          shows up here.
        </p>
        <p v-else class="text-foreground/60 max-w-md text-sm text-balance">
          Connect to your Mac any time in Settings › Sync.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>Clipboard</template>
          <SettingsField>
            <template #label>Save clipboard on open</template>
            <template #description>
              Add what you copied in other apps when you open Teneo
            </template>
            <Switch v-model="captureOnOpen" />
          </SettingsField>
        </SettingsSection>
      </section>
    </Transition>

    <footer class="flex shrink-0 flex-col items-center gap-y-5 pt-4">
      <!-- where the user is in the steps -->
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
        @click="currentStep = 'sync'">
        Continue
      </Button>
      <div
        v-else-if="currentStep === 'sync'"
        class="flex w-full flex-col items-center gap-y-2">
        <Button
          v-if="isSyncOn"
          size="lg"
          class="w-full max-w-xs"
          @click="currentStep = 'ready'">
          Continue
        </Button>
        <template v-else>
          <Button
            size="lg"
            class="w-full max-w-xs"
            :disabled="isBusy || !recoveryCode.trim()"
            @click="joinWithCode">
            <Spinner v-if="isBusy" /> Join
          </Button>
          <Button
            variant="ghost"
            size="sm"
            :disabled="isBusy"
            @click="currentStep = 'ready'">
            Set up later
          </Button>
        </template>
      </div>
      <Button v-else size="lg" class="w-full max-w-xs" @click="finishSetup">
        Done
      </Button>
    </footer>
  </div>
</template>
