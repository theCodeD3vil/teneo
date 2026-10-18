<script lang="ts" setup>
import { ref } from "vue";

import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

type StorageDuration = "day" | "week" | "month" | "year" | "forever";
const durationOptions: { value: StorageDuration; label: string }[] = [
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "year", label: "1 year" },
  { value: "forever", label: "forever" },
];

// UI only for now: not persisted or wired to the backend yet
const historyDuration = ref("forever");
const maximumItems = ref("unlimited");
</script>
<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>History</template>

      <SettingsField>
        <template #label>Keep history for</template>
        <template #description>Older items are deleted automatically</template>
        <NativeSelect class="capitalize!" v-model="historyDuration" size="sm">
          <NativeSelectOption
            class="capitalize!"
            v-for="duration in durationOptions"
            :value="duration.value"
            :key="duration.value"
            >{{ duration.label }}</NativeSelectOption
          >
        </NativeSelect>
      </SettingsField>

      <SettingsField>
        <template #label>Maximum items</template>
        <template #description>The oldest items go first</template>
        <NativeSelect v-model="maximumItems" size="sm">
          <NativeSelectOption value="100">100</NativeSelectOption>
          <NativeSelectOption value="500">500</NativeSelectOption>
          <NativeSelectOption value="1000">1,000</NativeSelectOption>
          <NativeSelectOption value="unlimited">Unlimited</NativeSelectOption>
        </NativeSelect>
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Data</template>

      <SettingsField disabled>
        <template #label>Data folder</template>
        <template #description>
          Where Teneo keeps your history and saved images
        </template>
        <Button variant="outline" size="sm">Show in Finder</Button>
      </SettingsField>

      <SettingsField>
        <template #label>Clear history</template>
        <template #description>Delete every item and saved image</template>
        <Button variant="destructive" size="sm">Clear history</Button>
      </SettingsField>
    </SettingsSection>
  </div>
</template>
