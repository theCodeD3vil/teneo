<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { computed, onMounted, ref } from "vue";

import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/composables/useSettings";

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

// Launch at login is system state (a login item), not a stored setting
const launchAtLoginStatus = ref<TinyLoginStatus | null>(null);
const launchAtLogin = computed({
  get: () => launchAtLoginStatus.value === "enabled",
  set: async (enabled) => {
    launchAtLoginStatus.value = await tiny.app.launchAtLogin.set(enabled);
  },
});

async function refreshLaunchAtLoginStatus(): Promise<void> {
  launchAtLoginStatus.value = await tiny.app.launchAtLogin.get();
}

onMounted(refreshLaunchAtLoginStatus);
// Login items are approved in System Settings, so re-check when the user comes back
useEventListener(window, "focus", refreshLaunchAtLoginStatus);
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
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
        <Switch v-model="launchAtLogin" />
      </SettingsField>

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
  </div>
</template>
