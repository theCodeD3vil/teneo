<script lang="ts" setup>
import { useMutation, useQuery } from "@tanstack/vue-query";
import { Button } from "@teneo/ui/components/button";
import { computed } from "vue";

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

// set when Teneo removed the fake 0.4.2's backdoor from this Mac
const { data: backdoorFoundAt } = useQuery({
  queryKey: ["security-notice"],
  queryFn: (): Promise<number | null> => tiny.api.call("securityNotice"),
  staleTime: Infinity,
});
const foundOn = computed(() =>
  backdoorFoundAt.value
    ? new Date(backdoorFoundAt.value).toLocaleDateString(undefined, {
        dateStyle: "long",
      })
    : null,
);

const updateStatus = computed(() => {
  if (checkForUpdateMutation.isError.value) return "Couldn't check for updates";
  const update = checkForUpdateMutation.data.value;
  if (!update) return "";
  return update.available
    ? `Teneo ${update.latest} is available`
    : "Teneo is up to date";
});
</script>
<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection v-if="foundOn">
      <template #section-title>Security notice</template>
      <p class="text-foreground/70 text-sm leading-relaxed">
        On {{ foundOn }} Teneo found and removed harmful software that a fake
        Teneo 0.4.2 had installed on this Mac. It could read what you copied.
        Change the passwords and API keys you copied since 16 November 2026, and
        sign out of other sessions where you can.
      </p>
    </SettingsSection>

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
        <template v-if="updateStatus" #description>
          {{ updateStatus }}
        </template>
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
  </div>
</template>
