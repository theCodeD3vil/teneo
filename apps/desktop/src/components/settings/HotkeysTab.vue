<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>Global</template>

      <SettingsField>
        <template #label>Open Teneo</template>
        <template #description>
          <span v-if="recordingError" class="text-destructive">
            {{ recordingError }}
          </span>
          <template v-else>Show the clipboard panel from any app</template>
        </template>
        <ShortcutRecorder
          v-model="openPanelShortcut"
          @error="recordingError = $event" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>In the panel</template>

      <SettingsField v-for="hotkey in hotkeyDefinitions" :key="hotkey.id">
        <template #label>
          <span class="font-light">
            {{ hotkey.description }}
          </span>
        </template>
        <Kbd class="bg-foreground/10 dark:bg-foreground/15">{{
          hotkey.shortcut
        }}</Kbd>
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>In a preview</template>

      <SettingsField
        v-for="hotkey in previewHotkeyDefinitions"
        :key="hotkey.id">
        <template #label>
          <span class="font-light">
            {{ hotkey.description }}
          </span>
        </template>
        <Kbd class="bg-foreground/10 dark:bg-foreground/15">{{
          hotkey.shortcut
        }}</Kbd>
      </SettingsField>
    </SettingsSection>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";

import { Kbd } from "@/components/ui/kbd";
import { useSettings } from "@/composables/useSettings";
import {
  hotkeyDefinitions,
  previewHotkeyDefinitions,
} from "@/constants/hotkeys";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
import ShortcutRecorder from "./ShortcutRecorder.vue";

const { settings, updateSettings } = useSettings();

const openPanelShortcut = computed({
  get: () => settings.value.openPanelShortcut,
  set: (shortcut) => updateSettings({ openPanelShortcut: shortcut }),
});

const recordingError = ref<string | null>(null);
</script>
