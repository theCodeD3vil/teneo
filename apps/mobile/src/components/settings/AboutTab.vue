<script lang="ts" setup>
import { Button } from "@teneo/ui/components/button";

import { useNavigation } from "../../composables/useNavigation";
import ExternalLink from "./ExternalLink.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const version = __APP_VERSION__;
const { openSetup } = useNavigation();
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <SettingsField>
        <template #label>Version</template>
        <span class="text-foreground/60 text-sm">{{ version }}</span>
      </SettingsField>

      <SettingsField>
        <template #label>Made by</template>
        <ExternalLink name="c0d3v1l" url="https://michaelnji.codes" />
      </SettingsField>

      <SettingsField>
        <template #label>Welcome</template>
        <template #description>See the setup steps again</template>
        <Button variant="outline" size="sm" @click="openSetup">Show</Button>
      </SettingsField>
    </SettingsSection>
  </div>
</template>
