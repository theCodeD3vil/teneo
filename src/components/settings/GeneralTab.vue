<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { onMounted, ref } from "vue";
import TickIcon from "~icons/hugeicons/tick-02";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

// UI only for now: not persisted or wired to the backend yet
const launchAtLogin = ref(false);
const checkForUpdates = ref(false);
const pasteOnEnter = ref(false);
const ignorePasswords = ref(true);
const playCopySound = ref(false);

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
</script>

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

      <SettingsField disabled>
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

      <SettingsField disabled>
        <template #label>Play sound when copying</template>
        <Switch v-model="playCopySound" />
      </SettingsField>
    </SettingsSection>

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
  </div>
</template>
