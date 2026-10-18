<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";
import AddIcon from "~icons/hugeicons/add-01";
import CancelIcon from "~icons/hugeicons/cancel-01";
import TickIcon from "~icons/hugeicons/tick-02";

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
import { useExcludedApps } from "@/composables/useExcludedApps";
import { useSettings } from "@/composables/useSettings";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();

// Accessibility lets Teneo post ⌘V to paste into other apps
const accessibilityStatus = ref<TinyPermissionStatus | null>(null);

async function refreshAccessibilityStatus(): Promise<void> {
  accessibilityStatus.value = await tiny.app.permissions.check("accessibility");
}

async function requestAccessibility(): Promise<void> {
  await tiny.app.permissions.request("accessibility");
  await refreshAccessibilityStatus();
}

onMounted(refreshAccessibilityStatus);
// Access is granted in System Settings, so re-check when the user comes back
useEventListener(window, "focus", refreshAccessibilityStatus);

// Turning this off keeps passwords in history, so it asks first
const isPasswordWarningOpen = ref(false);
const ignorePasswords = computed({
  get: () => settings.value.ignorePasswords,
  set: (enabled) => {
    if (enabled) void updateSettings({ ignorePasswords: true });
    else isPasswordWarningOpen.value = true;
  },
});

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
