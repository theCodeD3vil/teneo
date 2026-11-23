<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";
import { Spinner } from "@teneo/ui/components/spinner";
import { cn } from "@teneo/ui/lib/utils";
import { useIntervalFn } from "@vueuse/core";
import { ref, watch } from "vue";
import TickIcon from "~icons/tabler/check";
import CheckmarkCircleIcon from "~icons/tabler/circle-check";
import ComputerIcon from "~icons/tabler/device-desktop";
import DownloadCircleIcon from "~icons/tabler/download";
import LinkIcon from "~icons/tabler/external-link";
import FileIcon from "~icons/tabler/file";

import SettingsField from "@/components/settings/SettingsField.vue";
import SettingsSection from "@/components/settings/SettingsSection.vue";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { useFolderAccess } from "@/composables/useFolderAccess";
import { useHistoryProtection } from "@/composables/useHistoryProtection";
import { useLaunchAtLogin } from "@/composables/useLaunchAtLogin";
import { useSecretEncryption } from "@/composables/useSecretEncryption";
import { useSettings } from "@/composables/useSettings";
import { useSyncStatus } from "@/composables/useSyncStatus";

const steps = [
  "welcome",
  "permissions",
  "files",
  "keys",
  "sync",
  "login",
  "ready",
] as const;
const currentStep = ref<(typeof steps)[number]>("welcome");

const {
  status: accessibilityStatus,
  refresh: refreshAccessibilityStatus,
  request: requestAccessibility,
} = useAccessibilityPermission();
const requestedAccessibility = ref(false);
async function allowPasting(): Promise<void> {
  requestedAccessibility.value = true;
  await requestAccessibility();
}

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

// A button only requests the named folder, never all three at once.
const {
  status: folderAccess,
  loading: loadingFolders,
  requesting: requestingFolder,
  error: folderError,
  setEnabled: setFolderEnabled,
} = useFolderAccess();

// Same icons as Finder's sidebar
const folders = [
  { name: "Desktop", icon: ComputerIcon },
  { name: "Documents", icon: FileIcon },
  { name: "Downloads", icon: DownloadCircleIcon },
] as const;

// Off unless the user turns it on; turning it on reads the Keychain now
const { settings } = useSettings();
const {
  isChanging: isChangingEncryption,
  error: encryptionError,
  setEncryption,
} = useSecretEncryption();

const { status: launchAtLoginStatus, isEnabled: launchAtLogin } =
  useLaunchAtLogin();
const {
  status: protection,
  restore,
  busy: restoring,
  error: restoreError,
} = useHistoryProtection();
const {
  status: sync,
  turnOn: startSync,
  resume: resumeSync,
  isBusy: configuringSync,
  error: syncError,
} = useSyncStatus();

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
          Accessibility lets Teneo paste into the active app.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>Permissions</template>
          <SettingsField>
            <template #label>Accessibility</template>
            <template #description>Optional for manual pasting</template>
            <span
              v-if="accessibilityStatus === 'granted'"
              class="text-success flex items-center gap-1 text-sm">
              <TickIcon /> Granted
            </span>
            <Button
              v-else-if="accessibilityStatus"
              variant="outline"
              size="sm"
              @click="allowPasting">
              Allow pasting
            </Button>
          </SettingsField>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          Enable Teneo in System Settings, then return here.
        </p>
      </section>

      <section
        v-else-if="currentStep === 'files'"
        key="files"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Preview the files you copy</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          Enable a folder to see thumbnails and sizes for files you copy. macOS
          may ask for access the first time.
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
              v-if="folderAccess[name] === 'granted'"
              class="text-success flex items-center gap-1 text-sm">
              <TickIcon /> Enabled
            </span>
            <span
              v-else-if="folderAccess[name] === 'denied'"
              class="text-foreground/60 text-sm">
              Not allowed
            </span>
            <Button
              v-else
              size="sm"
              variant="outline"
              :disabled="loadingFolders || requestingFolder !== null"
              @click="setFolderEnabled(name, true)">
              <Spinner v-if="requestingFolder === name" />
              Enable {{ name }}
            </Button>
          </SettingsField>
          <p
            v-if="folderError"
            role="alert"
            class="text-destructive px-3 py-2.5 text-sm">
            {{ folderError }}
          </p>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          Copying still works without previews.
        </p>
      </section>

      <section
        v-else-if="currentStep === 'keys'"
        key="keys"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Keep API keys safe</h1>
        <p class="text-foreground/60 max-w-md text-xs text-balance">
          Keychain stores the key that encrypts saved secrets.
        </p>

        <SettingsSection class="mt-4 w-full text-left">
          <template #section-title>API Keys</template>
          <SettingsField>
            <template #label>Encrypt API keys</template>
            <template #description>
              macOS may ask for your password.
              <span v-if="encryptionError" class="text-destructive block">
                {{ encryptionError }}
              </span>
            </template>
            <Spinner v-if="isChangingEncryption || restoring" />
            <Button
              v-else-if="protection?.needsKeychainAccess"
              variant="outline"
              size="sm"
              @click="restore"
              >Restore access</Button
            >
            <span
              v-else-if="settings.encryptSecrets"
              class="text-success text-sm"
              >On</span
            >
            <Button
              v-else
              variant="outline"
              size="sm"
              @click="setEncryption(true)"
              >Set up encryption</Button
            >
          </SettingsField>
        </SettingsSection>
        <p class="text-foreground/60 text-xs text-balance">
          Masking works even without encryption.
        </p>
        <p v-if="restoreError" class="text-destructive text-xs" role="alert">
          {{ restoreError }}
        </p>
      </section>

      <section
        v-else-if="currentStep === 'sync'"
        key="sync"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Sync with your other devices</h1>
        <p class="text-foreground/60 max-w-md text-sm text-balance">
          Local Network finds nearby devices; Keychain stores the sync key.
        </p>
        <p v-if="sync?.running" class="text-success text-sm">Sync is on</p>
        <Button
          v-else-if="sync?.available"
          variant="outline"
          :disabled="configuringSync"
          @click="sync.enabled ? resumeSync() : startSync()">
          <Spinner v-if="configuringSync" />
          {{ sync.enabled ? "Resume sync" : "Turn on sync" }}
        </Button>
        <p
          v-if="syncError || sync?.problem"
          class="text-destructive text-xs"
          role="alert">
          {{ syncError || sync?.problem }}
        </p>
      </section>

      <section
        v-else-if="currentStep === 'login'"
        key="login"
        class="flex flex-1 flex-col items-center justify-center gap-y-4 text-center">
        <h1 class="text-2xl font-medium">Open Teneo at login</h1>
        <p class="text-foreground/60 max-w-md text-sm text-balance">
          A login item starts Teneo automatically to keep saving history.
        </p>

        <SettingsSection
          v-if="launchAtLoginStatus && launchAtLoginStatus !== 'unsupported'"
          class="mt-4 w-full text-left">
          <template #section-title>Startup</template>
          <SettingsField>
            <template #label>Open Teneo at login</template>
            <span v-if="launchAtLogin" class="text-success text-sm">On</span>
            <span
              v-else-if="launchAtLoginStatus === 'requires-approval'"
              class="text-sm"
              >Approval needed in Login Items</span
            >
            <Button
              v-else
              variant="outline"
              size="sm"
              @click="launchAtLogin = true"
              >Allow at login</Button
            >
          </SettingsField>
        </SettingsSection>
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
        <p
          v-if="accessibilityStatus !== 'granted'"
          class="text-foreground/60 max-w-md text-xs text-balance">
          To turn on automatic pasting later, go to Settings › Security.
        </p>
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
          <template v-if="requestedAccessibility"
            ><Spinner /> Waiting for access</template
          >
          <template v-else>Not enabled</template>
          <span aria-hidden="true">·</span>
          <!-- moves on; Settings › Security grants access later -->
          <Button variant="ghost" size="sm" @click="currentStep = 'files'">
            Set up later <LinkIcon />
          </Button>
        </template>
      </div>
      <Button
        v-else-if="currentStep === 'files'"
        size="lg"
        class="w-full max-w-xs"
        :disabled="requestingFolder !== null"
        @click="currentStep = 'keys'">
        {{
          Object.values(folderAccess).includes("granted")
            ? "Continue"
            : "Set up later"
        }}
      </Button>
      <Button
        v-else-if="currentStep === 'keys'"
        size="lg"
        class="w-full max-w-xs"
        :disabled="isChangingEncryption"
        @click="currentStep = sync?.available ? 'sync' : 'login'">
        {{ settings.encryptSecrets ? "Continue" : "Set up later" }}
      </Button>
      <Button
        v-else-if="currentStep === 'sync'"
        size="lg"
        class="w-full max-w-xs"
        :disabled="configuringSync"
        @click="currentStep = 'login'">
        {{ sync?.running ? "Continue" : "Set up later" }}
      </Button>
      <Button
        v-else-if="currentStep === 'login'"
        size="lg"
        class="w-full max-w-xs"
        @click="currentStep = 'ready'">
        {{
          launchAtLogin || launchAtLoginStatus === "unsupported"
            ? "Continue"
            : "Set up later"
        }}
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
