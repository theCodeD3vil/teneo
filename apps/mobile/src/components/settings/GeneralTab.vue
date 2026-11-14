<script lang="ts" setup>
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
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";

import { useBackToClose } from "../../composables/useNavigation";
import { useSettings } from "../../composables/useSettings";
import BetaBadge from "../BetaBadge.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();

const captureOnOpen = computed({
  get: () => settings.value.captureOnOpen,
  set: (enabled) => updateSettings({ captureOnOpen: enabled }),
});

// Turning this off shows keys in full in history, so it asks first
const isHideSecretsWarningOpen = ref(false);
useBackToClose(isHideSecretsWarningOpen);
const hideSecrets = computed({
  get: () => settings.value.hideSecrets,
  set: (enabled) => {
    if (enabled) void updateSettings({ hideSecrets: true });
    else isHideSecretsWarningOpen.value = true;
  },
});
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>Clipboard</template>

      <SettingsField>
        <template #label>Save clipboard on open</template>
        <template #description>
          Add what you copied in other apps when you open Teneo
        </template>
        <Switch v-model="captureOnOpen" />
      </SettingsField>
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
          Show keys and other secrets as asterisks in history. Copying still
          gives the full key.
        </template>
        <Switch v-model="hideSecrets" />
      </SettingsField>
    </SettingsSection>

    <AlertDialog v-model:open="isHideSecretsWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>Show API keys in history?</AlertDialogTitle>
          <AlertDialogDescription>
            Keys and other secrets will show in full in Teneo's history, where
            anyone who sees your screen can read them.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="updateSettings({ hideSecrets: false })">
            Show keys
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
