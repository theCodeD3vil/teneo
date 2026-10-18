<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>Startup</template>

      <SettingsField>
        <template #label>Launch at login</template>
        <template #description>
          Start Teneo when you log in to your Mac
        </template>
        <Switch v-model="launchAtLogin" />
      </SettingsField>

      <SettingsField>
        <template #label>Check for updates</template>
        <template #description>Look for new versions automatically</template>
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

      <SettingsField>
        <template #label>Ignore passwords</template>
        <template #description>
          Skip items password managers mark as sensitive
        </template>
        <Switch v-model="ignorePasswords" />
      </SettingsField>

      <SettingsField>
        <template #label>Play sound when copying</template>
        <Switch v-model="playCopySound" />
      </SettingsField>
    </SettingsSection>
  </div>
</template>

<script lang="ts" setup>
import { ref } from "vue";

import { Switch } from "@/components/ui/switch";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

// UI only for now: not persisted or wired to the backend yet
const launchAtLogin = ref(false);
const checkForUpdates = ref(true);
const pasteOnEnter = ref(false);
const ignorePasswords = ref(true);
const playCopySound = ref(false);
</script>
