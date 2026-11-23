<script lang="ts" setup>
import type { FolderAccess } from "@teneo/shared/types/storage";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@teneo/ui/components/alert-dialog";
import { Button } from "@teneo/ui/components/button";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";
import LockIcon from "~icons/tabler/lock";
import LockOpenIcon from "~icons/tabler/lock-open";
import AddIcon from "~icons/tabler/plus";
import CancelIcon from "~icons/tabler/x";

import BetaBadge from "@/components/BetaBadge.vue";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { useDelayedBusy } from "@/composables/useDelayedBusy";
import { useExcludedApps } from "@/composables/useExcludedApps";
import { useFolderAccess } from "@/composables/useFolderAccess";
import { useHistoryProtection } from "@/composables/useHistoryProtection";
import {
  folderExplanation,
  usePermissionConfirmation,
} from "@/composables/usePermissionConfirmation";
import { useSecretEncryption } from "@/composables/useSecretEncryption";
import { useSettings } from "@/composables/useSettings";

import PermissionConfirmation from "./PermissionConfirmation.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
import SettingsStatus from "./SettingsStatus.vue";

const { settings, updateSettings } = useSettings();

const { status: accessibilityStatus, request: requestAccessibility } =
  useAccessibilityPermission();
const { prompt, explain, cancel, confirm } = usePermissionConfirmation();
const folders = ["Desktop", "Documents", "Downloads"] as const;
const {
  status: folderStatus,
  loading: loadingFolders,
  requesting: requestingFolder,
  error: folderError,
  setEnabled: setFolderEnabled,
} = useFolderAccess();

function allowAccessibility(): void {
  explain(
    {
      title: "Allow Teneo to paste into other apps?",
      description:
        "Accessibility lets Teneo paste into the active app. Manual pasting still works without it.",
      action: "Open System Settings",
    },
    requestAccessibility,
  );
}

function allowFolder(name: FolderAccess["name"]): void {
  explain(
    {
      title: `Enable previews for ${name}?`,
      description: folderExplanation,
      action: "Enable previews",
    },
    () => setFolderEnabled(name, true),
  );
}

// Turning this off keeps passwords in history, so it asks first
const isPasswordWarningOpen = ref(false);
const ignorePasswords = computed({
  get: () => settings.value.ignorePasswords,
  set: (enabled) => {
    if (enabled) void updateSettings({ ignorePasswords: true });
    else isPasswordWarningOpen.value = true;
  },
});

// Turning this off shows keys in full in history, so it asks first
const isMaskSecretsWarningOpen = ref(false);
const maskSecrets = computed({
  get: () => settings.value.maskSecrets,
  set: (enabled) => {
    if (enabled) void updateSettings({ maskSecrets: true });
    else isMaskSecretsWarningOpen.value = true;
  },
});

const showLinkPreviews = computed({
  get: () => settings.value.showLinkPreviews,
  set: (enabled) => updateSettings({ showLinkPreviews: enabled }),
});

// Turning it off decrypts saved keys, so it asks first
const {
  isChanging: isChangingEncryption,
  error: encryptionError,
  setEncryption: setSecretEncryption,
} = useSecretEncryption();
const showEncryptionProgress = useDelayedBusy(isChangingEncryption);
const isDecryptWarningOpen = ref(false);
const isProtectionWarningOpen = ref(false);
const {
  status: protection,
  busy: isChangingProtection,
  error: protectionError,
  protect,
  unlock,
  lock,
  restore,
} = useHistoryProtection();
const encryptSecrets = computed({
  get: () => settings.value.encryptSecrets,
  set: (enabled) => {
    if (enabled)
      explain(
        {
          title: "Allow Keychain access to encrypt saved secrets?",
          description: "Keychain stores the key that encrypts saved secrets.",
          action: "Set up encryption",
        },
        () => setSecretEncryption(true),
      );
    else isDecryptWarningOpen.value = true;
  },
});

function restoreHistoryKey(): void {
  explain(
    {
      title: "Allow access to your history key?",
      description:
        "Teneo needs its Keychain key to read and save encrypted secrets.",
      action: "Restore access",
    },
    restore,
  );
}

function changeHistoryAuthentication(required: boolean): void {
  explain(
    {
      title: required
        ? "Require authentication to unlock secrets?"
        : "Turn off the unlock requirement?",
      description: required
        ? "Require Touch ID or your Mac password to unlock saved secrets."
        : "Secure Enclave will unlock saved secrets without asking you.",
      action: required ? "Continue to authentication" : "Turn off requirement",
    },
    () => protect(required),
  );
}

function requestHistoryUnlock(): void {
  explain(
    {
      title: "Unlock saved secrets?",
      description:
        "Use Touch ID or your Mac password to unlock secrets for five minutes.",
      action: "Continue to authentication",
    },
    unlock,
  );
}

function showSecretsInHistory(): void {
  void updateSettings({ maskSecrets: false });
}

function keepPasswordsInHistory(): void {
  void updateSettings({ ignorePasswords: false });
}

const {
  excludedApps,
  excludedAppsError,
  chooseAppToExclude,
  isChoosingApp,
  chooseAppError,
  removeExcludedApp,
} = useExcludedApps();
</script>

<template>
  <div class="grid gap-y-6">
    <SettingsSection>
      <template #section-title>Permissions</template>

      <SettingsField>
        <template #label>Accessibility</template>
        <template #description>Needed to paste into other apps</template>
        <SettingsStatus v-if="accessibilityStatus === 'granted'" tone="success">
          Granted
        </SettingsStatus>
        <Button
          v-else-if="accessibilityStatus"
          variant="outline"
          size="sm"
          @click="allowAccessibility">
          Grant access
        </Button>
      </SettingsField>
      <SettingsField v-for="name in folders" :key="name">
        <template #label>{{ name }}</template>
        <template #description>
          {{
            folderStatus[name] === "denied"
              ? "Not allowed. You can change this in System Settings → Privacy & Security → Files and Folders."
              : folderStatus[name] === "missing"
                ? "This folder isn’t available."
                : "Thumbnails and sizes of files you copy."
          }}
        </template>
        <Switch
          :model-value="folderStatus[name] === 'granted'"
          :disabled="loadingFolders || requestingFolder !== null"
          :aria-label="`File previews for ${name}`"
          :aria-busy="requestingFolder === name"
          @update:model-value="
            (enabled) =>
              enabled ? allowFolder(name) : setFolderEnabled(name, false)
          " />
      </SettingsField>
      <p
        v-if="folderError"
        role="alert"
        class="text-destructive px-3 py-2.5 text-sm">
        {{ folderError }}
      </p>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Sensitive Apps</template>

      <SettingsField>
        <template #label>Ignore sensitive apps</template>
        <template #description>
          Skip anything copied from the apps below
        </template>
        <Switch v-model="ignorePasswords" />
      </SettingsField>

      <p
        v-if="excludedAppsError && !excludedApps"
        class="text-destructive px-3 py-2.5 text-sm">
        Couldn't look up ignored apps
      </p>
      <p
        v-else-if="!excludedApps"
        class="text-foreground/60 px-3 py-2.5 text-sm">
        Looking for ignored apps…
      </p>
      <p
        v-else-if="excludedApps.length === 0"
        class="text-foreground/60 px-3 py-2.5 text-sm">
        No ignored apps on this Mac
      </p>
      <SettingsField
        v-for="excludedApp in excludedApps"
        :key="excludedApp.bundleId"
        :disabled="!settings.ignorePasswords">
        <template #label>
          <span class="flex items-center gap-2">
            <img
              v-if="excludedApp.iconUrl"
              :src="excludedApp.iconUrl"
              alt=""
              class="size-5" />
            <span v-else class="size-5" />
            {{ excludedApp.name }}
          </span>
        </template>
        <Button
          v-if="excludedApp.addedByUser"
          variant="ghost"
          size="icon-xs"
          :aria-label="`Stop ignoring ${excludedApp.name}`"
          @click="removeExcludedApp(excludedApp.bundleId)">
          <CancelIcon />
        </Button>
      </SettingsField>

      <div class="flex items-center justify-end gap-3 px-3 py-2">
        <p v-if="chooseAppError" class="text-destructive mr-auto text-xs">
          {{ chooseAppError.message }}
        </p>
        <Button
          variant="outline"
          size="sm"
          :disabled="!settings.ignorePasswords || isChoosingApp"
          @click="chooseAppToExclude">
          <AddIcon /> Add app
        </Button>
      </div>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Secrets</template>

      <SettingsField>
        <template #label>
          <span class="flex items-center gap-2">
            Hide secrets
            <BetaBadge />
          </span>
        </template>
        <template #description>
          Mask secrets in history. Pasting still gives the full secret.
        </template>
        <Switch v-model="maskSecrets" />
      </SettingsField>

      <SettingsField>
        <template #label>Encrypt secrets</template>
        <template #description>
          <template v-if="protection?.protected">
            Saved secrets are encrypted with a key protected by Secure Enclave.
          </template>
          <template v-else>
            Save secrets encrypted, with the key in your Keychain. macOS may ask
            for your Mac password to allow it, and again after updates.
          </template>
          <span v-if="encryptionError" class="text-destructive block">
            {{ encryptionError }}
          </span>
          <span
            v-if="showEncryptionProgress"
            role="status"
            class="mt-1 flex items-center gap-2">
            <Spinner aria-hidden="true" class="size-3" />
            Updating saved secrets…
          </span>
        </template>
        <Switch
          v-model="encryptSecrets"
          :disabled="
            isChangingEncryption ||
            isChangingProtection ||
            protection?.locked ||
            protection?.unreadable
          " />
      </SettingsField>

      <SettingsField v-if="settings.encryptSecrets && protection">
        <template #label>Hardware-backed encryption</template>
        <template #description>
          <template v-if="protection.unreadable">
            Teneo can’t read the protected key. Your encrypted entries haven’t
            been changed.
          </template>
          <template v-else-if="protection.protected"
            >Protects your history key on this Mac.</template
          >
          <template v-else-if="protection.available"
            >Keep the key that protects saved secrets bound to this
            Mac.</template
          >
          <template v-else
            >Secure Enclave isn’t available on this Mac.</template
          >
          <span
            v-if="protectionError"
            class="text-destructive block"
            role="alert"
            >{{ protectionError }}</span
          >
        </template>
        <SettingsStatus v-if="protection.unreadable" tone="danger" live>
          Unavailable
        </SettingsStatus>
        <SettingsStatus v-else-if="protection.protected" tone="success">
          On
        </SettingsStatus>
        <Button
          v-else-if="protection.available"
          variant="outline"
          size="sm"
          :disabled="isChangingEncryption || isChangingProtection"
          @click="isProtectionWarningOpen = true">
          Set up
        </Button>
      </SettingsField>

      <SettingsField v-if="protection?.needsKeychainAccess">
        <template #label>Saved secrets are unavailable</template>
        <template #description>
          Teneo couldn’t read the saved key from Keychain. Restore access to use
          your encrypted history again.
        </template>
        <Button
          size="sm"
          variant="outline"
          :disabled="isChangingProtection"
          @click="restoreHistoryKey"
          >Restore access</Button
        >
      </SettingsField>

      <SettingsField
        v-if="
          settings.encryptSecrets &&
          protection?.protected &&
          !protection.unreadable
        ">
        <template #label
          >Require authentication to unlock saved secrets</template
        >
        <template #description>
          Use Touch ID or your Mac password. Secrets lock again after five
          minutes.
        </template>
        <Switch
          :model-value="protection.requireAuthentication"
          :disabled="
            isChangingEncryption || isChangingProtection || protection.locked
          "
          aria-label="Require authentication to unlock saved secrets"
          @update:model-value="changeHistoryAuthentication" />
      </SettingsField>

      <SettingsField
        v-if="settings.encryptSecrets && protection?.requireAuthentication">
        <template #label>Saved secrets</template>
        <template #status>
          <SettingsStatus
            :tone="protection.locked ? 'warning' : 'success'"
            live>
            <template #icon>
              <component
                :is="protection.locked ? LockIcon : LockOpenIcon"
                aria-hidden="true"
                class="size-3 shrink-0" />
            </template>
            {{ protection.locked ? "Locked" : "Unlocked" }}
          </SettingsStatus>
        </template>
        <template #description>
          While locked, you can’t see or sync these entries, and new copies
          containing secrets aren’t saved to history.
        </template>
        <Button
          size="sm"
          variant="outline"
          :disabled="isChangingProtection"
          @click="protection.locked ? requestHistoryUnlock() : lock()">
          {{ protection.locked ? "Unlock" : "Lock now" }}
        </Button>
      </SettingsField>
    </SettingsSection>

    <AlertDialog v-model:open="isProtectionWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle
            >Protect saved secrets with Secure Enclave?</AlertDialogTitle
          >
          <AlertDialogDescription>
            Secure Enclave ties saved secrets to this Mac; backups won’t restore
            them on another Mac. Keychain access may be needed to replace the
            old key.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction @click="protect(false)"
            >Protect saved secrets</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <SettingsSection>
      <template #section-title>Links</template>

      <SettingsField>
        <template #label>Show link previews</template>
        <Switch v-model="showLinkPreviews" />
      </SettingsField>
    </SettingsSection>

    <AlertDialog v-model:open="isDecryptWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Stop encrypting secrets?</AlertDialogTitle>
          <AlertDialogDescription>
            Saved secrets become unencrypted. macOS may ask for Keychain access
            to read and remove the key.
            <template v-if="!protection?.protected">
              Any secret Teneo can’t decrypt is deleted from history.
            </template>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="setSecretEncryption(false)">
            Stop encrypting
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <PermissionConfirmation
      :prompt="prompt"
      @cancel="cancel"
      @confirm="confirm" />

    <AlertDialog v-model:open="isMaskSecretsWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Show secrets in history?</AlertDialogTitle>
          <AlertDialogDescription>
            Secrets will show in full in Teneo's history, where anyone who sees
            your screen can read them. They stay saved encrypted on this Mac.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="showSecretsInHistory">
            Show secrets
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isPasswordWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Keep passwords in history?</AlertDialogTitle>
          <AlertDialogDescription>
            Passwords and anything else you copy from these apps will be saved
            to Teneo's history on this Mac, unencrypted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="keepPasswordsInHistory">
            Keep passwords
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
