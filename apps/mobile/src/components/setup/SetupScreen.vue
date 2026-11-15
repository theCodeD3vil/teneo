<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { cn } from "@teneo/ui/lib/utils";
import { type Component, computed, onScopeDispose, ref, watch } from "vue";
import TickIcon from "~icons/tabler/check";
import ScanIcon from "~icons/tabler/scan";

import logoUrl from "../../assets/logo.svg";
import { holdBack, useNavigation } from "../../composables/useNavigation";
import { canScanQrCode, useQrScanner } from "../../composables/useQrScanner";
import { useSettings } from "../../composables/useSettings";
import { markSetupDone } from "../../composables/useSetup";
import { useSyncStatus } from "../../composables/useSyncStatus";
import ConnectIllustration from "../illustrations/ConnectIllustration.vue";
import ReadyIllustration from "../illustrations/ReadyIllustration.vue";
import SettingsField from "../settings/SettingsField.vue";
import SettingsSection from "../settings/SettingsSection.vue";

const steps = ["welcome", "sync", "ready"] as const;
const currentStep = ref<(typeof steps)[number]>("welcome");

const { currentState, goBack, replaceScreen } = useNavigation();

// Past the first step, the back gesture goes to the step before instead of
// leaving setup (which, on first run, would leave the app)
let letGoOfBack: (() => void) | null = null;

function holdBackPastFirstStep(): void {
  if (letGoOfBack || currentStep.value === steps[0]) return;
  letGoOfBack = holdBack(() => {
    letGoOfBack = null;
    const index = steps.indexOf(currentStep.value);
    if (index > 0) currentStep.value = steps[index - 1]!;
    holdBackPastFirstStep();
  });
}

// sync: the hold is taken before anything else can change the history
watch(currentStep, holdBackPastFirstStep, { flush: "sync" });

function letGoOfBackGesture(): void {
  letGoOfBack?.();
  letGoOfBack = null;
}
onScopeDispose(letGoOfBackGesture);
const { status, isBusy, error, join } = useSyncStatus();
const { settings, updateSettings } = useSettings();

const isSyncOn = computed(
  () =>
    status.value !== null &&
    status.value.state !== "off" &&
    status.value.state !== "not_paired",
);

const recoveryCode = ref("");
const hasJoined = ref(false);
const joinedDeviceName = ref<string | null>(null);

async function joinWith(code: string): Promise<void> {
  const joined = await join(code);
  if (!joined) return;
  hasJoined.value = true;
  joinedDeviceName.value = joined.deviceName;
  recoveryCode.value = "";
  currentStep.value = "ready";
}

// Scanning the Mac's QR code is the quick way; typing its recovery code is
// for when the camera can't be used
const { scan, isPreparing, isScanning } = useQrScanner();
const scanError = ref("");

async function scanAndJoin(): Promise<void> {
  scanError.value = "";
  try {
    const code = await scan();
    if (code) await joinWith(code);
  } catch (caught) {
    scanError.value = caught instanceof Error ? caught.message : String(caught);
  }
}

const captureOnOpen = computed({
  get: () => settings.value.captureOnOpen,
  set: (enabled) => updateSettings({ captureOnOpen: enabled }),
});

// First run replaces itself with the history; opened from Settings, it goes back
function finishSetup(): void {
  markSetupDone();
  letGoOfBackGesture();
  if (currentState.value.index > 0) goBack();
  else replaceScreen("history");
}

const isJoining = computed(
  () => currentStep.value === "sync" && !isSyncOn.value,
);
const canSetUpLater = isJoining;

interface FooterAction {
  label: string;
  run: () => unknown;
  icon?: Component;
  disabled?: boolean;
  isBusy?: boolean;
}

const primaryAction = computed<FooterAction>(() => {
  if (currentStep.value === "welcome") {
    return { label: "Continue", run: () => (currentStep.value = "sync") };
  }
  // the button scans until a code is typed, then joins with it
  if (isJoining.value && canScanQrCode && !recoveryCode.value.trim()) {
    return {
      label: isPreparing.value ? "Getting the scanner ready…" : "Scan QR code",
      run: scanAndJoin,
      icon: ScanIcon,
      disabled: isBusy.value || isScanning.value,
      isBusy: isBusy.value || isPreparing.value,
    };
  }
  if (isJoining.value) {
    return {
      label: "Join",
      run: () => joinWith(recoveryCode.value),
      disabled: isBusy.value || !recoveryCode.value.trim(),
      isBusy: isBusy.value,
    };
  }
  if (currentStep.value === "sync") {
    return { label: "Continue", run: () => (currentStep.value = "ready") };
  }
  return { label: "Done", run: finishSetup };
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col px-2">
    <!-- The steps share one grid cell, so the old one slides out while the
         new one slides in, and the space they fill never collapses between
         them -->
    <div class="grid min-h-0 flex-1 overflow-hidden">
      <Transition
        enter-active-class="transition duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
        enter-from-class="translate-x-12 opacity-0"
        leave-active-class="transition duration-200 ease-in motion-reduce:transition-none"
        leave-to-class="-translate-x-12 opacity-0">
        <section
          v-if="currentStep === 'welcome'"
          key="welcome"
          class="col-start-1 row-start-1 flex min-h-0 flex-col items-center justify-center gap-y-4 text-center">
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
          class="col-start-1 row-start-1 flex min-h-0 flex-col items-center justify-center gap-y-4 overflow-y-auto text-center">
          <ConnectIllustration class="w-52 shrink-0" />
          <h1 class="text-2xl font-medium text-balance">Connect to your Mac</h1>
          <p class="text-foreground/60 max-w-md text-xs text-balance">
            On your Mac, open Teneo's Settings › Sync and choose Add a device.
            {{
              canScanQrCode
                ? "Scan the QR code it shows."
                : "Type the join code it shows."
            }}
          </p>

          <SettingsSection class="mt-4 w-full text-left">
            <template #section-title>Sync</template>
            <SettingsField v-if="isSyncOn">
              <template #label>Sync is on</template>
              <span class="text-success flex items-center gap-1 text-sm">
                <TickIcon /> Joined
              </span>
            </SettingsField>
            <SettingsField v-else>
              <template #label>
                {{ canScanQrCode ? "Or type the join code" : "Join code" }}
              </template>
              <template #description
                >Shown under the QR code on your Mac</template
              >
              <template #footer>
                <form @submit.prevent="joinWith(recoveryCode)">
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
          <p
            v-if="scanError || error"
            class="text-destructive text-xs text-balance">
            {{ scanError || error }}
          </p>
          <p v-else class="text-foreground/60 text-xs text-balance">
            Your history syncs over Wi-Fi, encrypted, with no account or server.
          </p>
        </section>

        <section
          v-else
          key="ready"
          class="col-start-1 row-start-1 flex min-h-0 flex-col items-center justify-center gap-y-4 overflow-y-auto text-center">
          <ReadyIllustration class="w-52 shrink-0" />
          <h1 class="text-2xl font-medium">Teneo is ready</h1>
          <p
            v-if="joinedDeviceName"
            class="text-foreground/60 max-w-md text-sm text-balance">
            Connected to {{ joinedDeviceName }}. What you copy there shows up
            here.
          </p>
          <p
            v-else-if="hasJoined || isSyncOn"
            class="text-foreground/60 max-w-md text-sm text-balance">
            Teneo now syncs clipboard items when both devices are on the same
            network.
          </p>
          <p v-else class="text-foreground/60 max-w-md text-sm text-balance">
            Connect to your Mac any time in Settings › Sync.
          </p>

          <SettingsSection class="mt-4 w-full text-left">
            <template #section-title>Clipboard</template>
            <SettingsField>
              <template #label>Save clipboard on open</template>
              <Switch v-model="captureOnOpen" />
            </SettingsField>
          </SettingsSection>
        </section>
      </Transition>
    </div>

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

      <!-- the same two rows on every step, the second kept invisible when
           unused, so the footer never changes height and moves the step -->
      <div class="flex w-full flex-col items-center gap-y-2">
        <Button
          size="lg"
          class="w-full max-w-xs"
          :disabled="primaryAction.disabled"
          @click="primaryAction.run">
          <Spinner v-if="primaryAction.isBusy" />
          <component :is="primaryAction.icon" v-else-if="primaryAction.icon" />
          {{ primaryAction.label }}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          :class="!canSetUpLater && 'invisible'"
          :disabled="!canSetUpLater || isBusy"
          :aria-hidden="!canSetUpLater"
          @click="currentStep = 'ready'">
          Set up later
        </Button>
      </div>
    </footer>
  </div>
</template>
