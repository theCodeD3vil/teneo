<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>Global</template>

      <SettingsField>
        <template #label>Open Teneo</template>
        <template #description>Show the clipboard panel from any app</template>
        <Button variant="outline" size="sm">Record shortcut</Button>
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
        <Kbd class="bg-foreground/10">{{ hotkey.shortcut }}</Kbd>
      </SettingsField>
    </SettingsSection>
  </div>
</template>

<script lang="ts" setup>
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { hotkeyDefinitions } from "@/constants/hotkeys";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
</script>
