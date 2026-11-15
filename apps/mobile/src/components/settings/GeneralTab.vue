<script lang="ts" setup>
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";

import { useSettings } from "../../composables/useSettings";
import BetaBadge from "../BetaBadge.vue";
import ConfirmSheet from "../ConfirmSheet.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();

const captureOnOpen = computed({
  get: () => settings.value.captureOnOpen,
  set: (enabled) => updateSettings({ captureOnOpen: enabled }),
});

const showLinkPreviews = computed({
  get: () => settings.value.showLinkPreviews,
  set: (enabled) => updateSettings({ showLinkPreviews: enabled }),
});

// Turning this off shows keys in full in history, so it asks first
const isHideSecretsWarningOpen = ref(false);
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
          Add what you copied in other apps to history
        </template>
        <Switch v-model="captureOnOpen" />
      </SettingsField>
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
          Mask secrets in history. Copying still gives the full secret.
        </template>
        <Switch v-model="hideSecrets" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Links</template>

      <SettingsField>
        <template #label>Show link previews</template>
        <Switch v-model="showLinkPreviews" />
      </SettingsField>
    </SettingsSection>

    <ConfirmSheet
      v-model:open="isHideSecretsWarningOpen"
      title="Show secrets in history?"
      description="Secrets will show in full in Teneo's history, where anyone who sees your screen can read them."
      confirm-label="Show secrets"
      @confirm="updateSettings({ hideSecrets: false })" />
  </div>
</template>
