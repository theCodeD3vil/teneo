<script setup lang="ts">
import { useIntervalFn } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import TickIcon from "~icons/tabler/check";
import CheckmarkCircleIcon from "~icons/tabler/circle-check";
import ComputerIcon from "~icons/tabler/device-desktop";
import DownloadCircleIcon from "~icons/tabler/download";
import LinkIcon from "~icons/tabler/external-link";
import FileIcon from "~icons/tabler/file";

import SettingsField from "@/components/settings/SettingsField.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { useLaunchAtLogin } from "@/composables/useLaunchAtLogin";
import { useSecretEncryption } from "@/composables/useSecretEncryption";
import { useSettings } from "@/composables/useSettings";
import { cn } from "@/lib/utils";

import type { FolderAccess } from "../../shared/types/storage";

const steps = ["welcome", "permissions", "files", "keys", "ready"] as const;
const currentStep = ref<(typeof steps)[number]>("welcome");

const {
  status: accessibilityStatus,
  refresh: refreshAccessibilityStatus,
  request: requestAccessibility,
} = useAccessibilityPermission();

function continueFromWelcome(): void {
  currentStep.value =
    accessibilityStatus.value === "granted" ? "files" : "permissions";
}

// System Settings doesn't tell Teneo when access is granted, so keep asking
useIntervalFn(() => {
  if (currentStep.value === "permissions") void refreshAccessibilityStatus();
}, 1000);

// Move on once access is granted, after a moment to show that it worked
watch(accessibilityStatus, (status) => {
  if (status !== "granted" || currentStep.value !== "permissions") return;
  setTimeout(() => (currentStep.value = "files"), 800);
});

// Opening each folder is what makes macOS ask, so nothing is known until then
const folderAccess = ref<FolderAccess[] | null>(null);
const isRequestingFolders = ref(false);

async function requestFolderAccess(): Promise<void> {
  isRequestingFolders.value = true;
  try {
    folderAccess.value = await tiny.api.call("requestFolderAccess");
  } finally {
    isRequestingFolders.value = false;
  }
}

// Same icons as Finder's sidebar
const folders = [
  { name: "Desktop", icon: ComputerIcon },
  { name: "Documents", icon: FileIcon },
  { name: "Downloads", icon: DownloadCircleIcon },
] as const;
function folderStatus(name: string): FolderAccess["status"] | null {
  return (
    folderAccess.value?.find((folder) => folder.name === name)?.status ?? null
  );
}

// Off unless the user turns it on; turning it on reads the Keychain now
const { settings } = useSettings();
const {
  isChanging: isChangingEncryption,
  error: encryptionError,
  setEncryption,
} = useSecretEncryption();
const encryptSecrets = computed({
  get: () => settings.value.encryptSecrets,
  set: (enabled) => void setEncryption(enabled),
});

const { status: launchAtLoginStatus, isEnabled: launchAtLogin } =
  useLaunchAtLogin();

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
        v-else-if="currentStep === 'files'"
        key="files"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Preview the files you copy</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          To show previews and sizes of files you copy from these folders, Teneo
          needs to see them. macOS asks about each one.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>Folders</template>
          <SettingsField v-for="{ name, icon } in folders" :key="name">
            <template #label>
              <span class="flex items-center gap-2">
                <component :is="icon" class="text-primary size-4" />
                {{ name }}
              </span>
            </template>
            <span
              v-if="folderStatus(name) === 'granted'"
              class="text-success flex items-center gap-1 text-sm">
              <TickIcon /> Allowed
            </span>
            <span
              v-else-if="folderStatus(name) === 'denied'"
              class="text-foreground/60 text-sm">
              Not allowed
            </span>
          </SettingsField>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          Files you copy always paste, even from folders Teneo can't see. Change
          this later in System Settings › Privacy & Security › Files and
          Folders.
        </p>
      </section>

      <section
        v-else-if="currentStep === 'keys'"
        key="keys"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Keep API keys safe</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          Teneo hides API keys you copy in your history. It can also save them
          encrypted, with the key that unlocks them in your Keychain.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>API Keys</template>
          <SettingsField>
            <template #label>Encrypt API keys</template>
            <template #description>
              macOS may ask for your Mac password to let Teneo use your
              Keychain, and again after updates.
              <span v-if="encryptionError" class="text-destructive block">
                {{ encryptionError }}
              </span>
            </template>
            <Spinner v-if="isChangingEncryption" />
            <Switch v-else v-model="encryptSecrets" />
          </SettingsField>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          You can change this later in Settings › Security.
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

        <SettingsSection
          v-if="launchAtLoginStatus && launchAtLoginStatus !== 'unsupported'"
          class="mt-4 w-full text-left">
          <template #section-title>Startup</template>
          <SettingsField>
            <template #label>Open Teneo at login</template>
            <template #description>
              Keep your history going after you restart your Mac
            </template>
            <Switch v-model="launchAtLogin" />
          </SettingsField>
        </SettingsSection>
      </section>
    </Transition>

    <footer class="flex shrink-0 flex-col items-center gap-y-5">
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
          <!-- moves on; Settings › Security grants access later -->
          <Button variant="ghost" size="sm" @click="currentStep = 'files'">
            Set up later <LinkIcon />
          </Button>
        </template>
      </div>
      <div
        v-else-if="currentStep === 'files'"
        class="flex w-full flex-col items-center gap-y-2">
        <Button
          v-if="!folderAccess"
          size="lg"
          class="w-full max-w-xs"
          :disabled="isRequestingFolders"
          @click="requestFolderAccess">
          <Spinner v-if="isRequestingFolders" /> Allow access
        </Button>
        <Button
          v-else
          size="lg"
          class="w-full max-w-xs"
          @click="currentStep = 'keys'">
          Continue
        </Button>
        <Button
          v-if="!folderAccess"
          variant="ghost"
          size="sm"
          :disabled="isRequestingFolders"
          @click="currentStep = 'keys'">
          Skip
        </Button>
      </div>
      <Button
        v-else-if="currentStep === 'keys'"
        size="lg"
        class="w-full max-w-xs"
        :disabled="isChangingEncryption"
        @click="currentStep = 'ready'">
        Continue
      </Button>
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
