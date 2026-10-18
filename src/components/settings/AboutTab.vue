<script lang="ts" setup>
import { useMutation } from "@tanstack/vue-query";
import { computed } from "vue";

import { Button } from "@/components/ui/button";
import { promptToInstallUpdate } from "@/utils/updates";

import { version } from "../../../tinyjs.json";
import ExternalLink from "./ExternalLink.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const checkForUpdateMutation = useMutation({
  mutationFn: async () => {
    const update = await tiny.api.call("update.check");
    if (update.available) await promptToInstallUpdate(update);
    return update;
  },
});

const updateStatus = computed(() => {
  if (checkForUpdateMutation.isError.value) return "Couldn't check for updates";
  const update = checkForUpdateMutation.data.value;
  if (!update) return "Look for a newer version of Teneo";
  return update.available
    ? `Teneo ${update.latest} is available`
    : "Teneo is up to date";
});
</script>
<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>About Teneo</template>

      <SettingsField>
        <template #label>Version</template>
        <span class="text-foreground/60 text-sm">{{ version }}</span>
      </SettingsField>

      <SettingsField>
        <template #label>Made by</template>
        <ExternalLink name="c0d3v1l" url="https://michaelnji.codes" />
      </SettingsField>

      <SettingsField>
        <template #label>Software update</template>
        <template #description>{{ updateStatus }}</template>
        <Button
          variant="outline"
          size="sm"
          :disabled="checkForUpdateMutation.isPending.value"
          @click="checkForUpdateMutation.mutate()">
          {{
            checkForUpdateMutation.isPending.value ? "Checking…" : "Check now"
          }}
        </Button>
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Credits</template>

      <SettingsField>
        <template #label>Logo</template>
        <ExternalLink name="shapes.gallery" url="https://shapes.gallery" />
      </SettingsField>
    </SettingsSection>
  </div>
</template>
