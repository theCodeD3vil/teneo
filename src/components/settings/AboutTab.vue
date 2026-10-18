<script lang="ts" setup>
import { Button } from "@/components/ui/button";

import { version } from "../../../tinyjs.json";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
</script>
<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>About Teneo</template>

      <SettingsField>
        <template #label>Version</template>
        <span class="text-foreground/60 text-sm">{{ version }}</span>
      </SettingsField>

      <SettingsField disabled>
        <template #label>Software update</template>
        <template #description>Look for a newer version of Teneo</template>
        <Button variant="outline" size="sm">Check now</Button>
      </SettingsField>
    </SettingsSection>
  </div>
</template>
