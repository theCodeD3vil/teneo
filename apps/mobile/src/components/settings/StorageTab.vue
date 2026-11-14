<script lang="ts" setup>
import { computed } from "vue";

import { useSettings } from "../../composables/useSettings";
import SelectSheet from "../SelectSheet.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

// in days; 0 = forever
const durationOptions = [
  { value: "1", label: "1 day" },
  { value: "7", label: "1 week" },
  { value: "30", label: "1 month" },
  { value: "365", label: "1 year" },
  { value: "0", label: "Forever" },
];

// 0 = no limit
const maximumItemsOptions = [
  { value: "100", label: "100" },
  { value: "500", label: "500" },
  { value: "1000", label: "1,000" },
  { value: "0", label: "Unlimited" },
];

const { settings, updateSettings } = useSettings();

// the options' values are strings; the settings are numbers
const historyDuration = computed({
  get: () => String(settings.value.historyRetentionDays),
  set: (value) => updateSettings({ historyRetentionDays: Number(value) }),
});

const maximumItems = computed({
  get: () => String(settings.value.maxItems),
  set: (value) => updateSettings({ maxItems: Number(value) }),
});
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>History</template>

      <SettingsField>
        <template #label>Keep history for</template>
        <template #description>
          Older items are deleted automatically; pinned items stay
        </template>
        <SelectSheet
          v-model="historyDuration"
          :options="durationOptions"
          title="Keep history for"
          description="Older items are deleted automatically; pinned items stay" />
      </SettingsField>

      <SettingsField>
        <template #label>Maximum items</template>
        <template #description>
          The oldest items go first; pinned items don't count
        </template>
        <SelectSheet
          v-model="maximumItems"
          :options="maximumItemsOptions"
          title="Maximum items"
          description="The oldest items go first; pinned items don't count" />
      </SettingsField>
    </SettingsSection>
  </div>
</template>
