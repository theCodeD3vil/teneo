<script lang="ts" setup>
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";

import { useLaunchAtLogin } from "@/composables/useLaunchAtLogin";
import {
  loginExplanation,
  usePermissionConfirmation,
} from "@/composables/usePermissionConfirmation";
import { useSettings } from "@/composables/useSettings";

import PermissionConfirmation from "./PermissionConfirmation.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

// UI only for now: not persisted or wired to the backend yet
const playCopySound = ref(false);

const { settings, updateSettings } = useSettings();

const checkForUpdates = computed({
  get: () => settings.value.checkForUpdates,
  set: (enabled) => updateSettings({ checkForUpdates: enabled }),
});

const pasteOnEnter = computed({
  get: () => settings.value.pasteOnEnter,
  set: (enabled) => updateSettings({ pasteOnEnter: enabled }),
});

const { status: launchAtLoginStatus, isEnabled: launchAtLogin } =
  useLaunchAtLogin();
const { prompt, explain, cancel, confirm } = usePermissionConfirmation();

function changeLaunchAtLogin(enabled: boolean): void {
  if (enabled) explain(loginExplanation, () => (launchAtLogin.value = true));
  else launchAtLogin.value = false;
}
</script>

<template>
  <div class="grid gap-y-6">
    <SettingsSection>
      <template #section-title>Startup</template>

      <SettingsField
        :disabled="
          !launchAtLoginStatus || launchAtLoginStatus === 'unsupported'
        ">
        <template #label>Launch at login</template>
        <template #description>
          <template v-if="launchAtLoginStatus === 'requires-approval'">
            Allow Teneo in System Settings › General › Login Items
          </template>
          <template v-else-if="launchAtLoginStatus === 'unsupported'">
            Only available in the installed app
          </template>
          <template v-else>Start Teneo when you log in to your Mac</template>
        </template>
        <Switch
          :model-value="launchAtLogin"
          @update:model-value="changeLaunchAtLogin" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Updates</template>
      <SettingsField>
        <template #label>Check for updates</template>
        <template #description>
          Look for a new version at launch and once a day
        </template>
        <Switch v-model="checkForUpdates" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Clipboard</template>

      <SettingsField>
        <template #label>Paste on Enter</template>
        <template #description>
          Paste into the active app instead of only copying
        </template>
        <Switch v-model="pasteOnEnter" />
      </SettingsField>

      <SettingsField disabled>
        <template #label>Play sound when copying</template>
        <Switch v-model="playCopySound" />
      </SettingsField>
    </SettingsSection>
    <PermissionConfirmation
      :prompt="prompt"
      @cancel="cancel"
      @confirm="confirm" />
  </div>
</template>
