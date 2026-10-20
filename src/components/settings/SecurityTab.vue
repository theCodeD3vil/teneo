<script lang="ts" setup>
import { computed, ref } from "vue";
import AddIcon from "~icons/hugeicons/add-01";
import CancelIcon from "~icons/hugeicons/cancel-01";
import TickIcon from "~icons/hugeicons/tick-02";

import BetaBadge from "@/components/BetaBadge.vue";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { useAccessibilityPermission } from "@/composables/useAccessibilityPermission";
import { useExcludedApps } from "@/composables/useExcludedApps";
import { useSecretEncryption } from "@/composables/useSecretEncryption";
import { useSettings } from "@/composables/useSettings";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();

const { status: accessibilityStatus, request: requestAccessibility } =
  useAccessibilityPermission();

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
const isDecryptWarningOpen = ref(false);
const encryptSecrets = computed({
  get: () => settings.value.encryptSecrets,
  set: (enabled) => {
    if (enabled) void setSecretEncryption(true);
    else isDecryptWarningOpen.value = true;
  },
});

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
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
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

    <SettingsSection>
      <template #section-title>Password Managers</template>

      <SettingsField>
        <template #label>Ignore password managers</template>
        <template #description>
          Skip anything copied from the apps below
        </template>
        <Switch v-model="ignorePasswords" />
      </SettingsField>

      <p
        v-if="excludedAppsError && !excludedApps"
        class="text-destructive px-3 py-2.5 text-sm">
        Couldn't look up password managers
      </p>
      <p
        v-else-if="!excludedApps"
        class="text-foreground/60 flex items-center gap-2 px-3 py-2.5 text-sm">
        <Spinner />
        Looking for password managers…
      </p>
      <p
        v-else-if="excludedApps.length === 0"
        class="text-foreground/60 px-3 py-2.5 text-sm">
        No password managers found on this Mac
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
          <AddIcon /> Add app…
        </Button>
      </div>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>API Keys</template>

      <SettingsField>
        <template #label>
          <span class="flex items-center gap-2">
            Hide API keys
            <BetaBadge />
          </span>
        </template>
        <template #description>
          Show keys and other secrets as asterisks in history. Pasting still
          gives the full key.
        </template>
        <Switch v-model="maskSecrets" />
      </SettingsField>

      <SettingsField>
        <template #label>Encrypt API keys</template>
        <template #description>
          Save keys encrypted, with the key that unlocks them in your Keychain.
          macOS may ask for your Mac password to allow it, and again after
          updates.
          <span v-if="encryptionError" class="text-destructive block">
            {{ encryptionError }}
          </span>
        </template>
        <Spinner v-if="isChangingEncryption" />
        <Switch v-else v-model="encryptSecrets" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Links</template>

      <SettingsField>
        <template #label>Show link previews</template>
        <template #description>
          Show the site's icon next to links you copy.
        </template>
        <Switch v-model="showLinkPreviews" />
      </SettingsField>
    </SettingsSection>

    <AlertDialog v-model:open="isDecryptWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>Stop encrypting API keys?</AlertDialogTitle>
          <AlertDialogDescription>
            Keys already in your history will be saved unencrypted on this Mac,
            and Teneo's key is removed from your Keychain. Any key Teneo can't
            decrypt is deleted from history.
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

    <AlertDialog v-model:open="isMaskSecretsWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>Show API keys in history?</AlertDialogTitle>
          <AlertDialogDescription>
            Keys and other secrets will show in full in Teneo's history, where
            anyone who sees your screen can read them. They stay saved encrypted
            on this Mac.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="showSecretsInHistory">
            Show keys
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isPasswordWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
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
