<script lang="ts" setup>
import { Switch } from "@teneo/ui/components/switch";
import { computed } from "vue";

import { useNavigation } from "../../composables/useNavigation";
import { useSettings } from "../../composables/useSettings";
import { useUpdates } from "../../composables/useUpdates";
import { formatSize } from "../../updates/updater";
import UpdateProgress from "../UpdateProgress.vue";
import ExternalLink from "./ExternalLink.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const version = __APP_VERSION__;
const { openSetup } = useNavigation();
const { settings, updateSettings } = useSettings();
const { state, check, install, cancel } = useUpdates();

const checkForUpdates = computed({
  get: () => settings.value.checkForUpdates,
  set: (enabled) => updateSettings({ checkForUpdates: enabled }),
});

const update = computed(() =>
  "update" in state.value ? state.value.update : null,
);

const updateStatus = computed(() => {
  const now = state.value;
  switch (now.kind) {
    case "idle":
      return "Look for a newer version of Teneo";
    case "checking":
      return "Checking…";
    case "up_to_date":
      return "Teneo is up to date";
    case "available":
      return `Teneo ${now.update.version} is available (${formatSize(now.update.size)})`;
    case "needs_permission":
      return "Allow Teneo to install apps, then tap Update again";
    case "downloading":
      return `Downloading Teneo ${now.update.version}…`;
    case "installing":
      return `Installing Teneo ${now.update.version}…`;
    case "failed":
      return now.message;
  }
  return "";
});

type Action = { label: string; run: () => unknown; disabled?: boolean };
const action = computed<Action>(() => {
  const kind = state.value.kind;
  if (kind === "checking") {
    return { label: "Checking…", run: () => undefined, disabled: true };
  }
  if (kind === "downloading") return { label: "Cancel", run: cancel };
  if (update.value) return { label: "Update", run: install };
  return { label: "Check now", run: check };
});
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <SettingsField>
        <template #label>Version</template>
        <span class="text-muted-foreground font-mono text-[0.9375rem]">
          {{ version }}
        </span>
      </SettingsField>

      <SettingsField>
        <template #label>Software update</template>
        <template #description>{{ updateStatus }}</template>
        <button
          type="button"
          class="pill-button"
          :disabled="action.disabled"
          @click="action.run()">
          {{ action.label }}
        </button>
        <template v-if="state.kind === 'downloading'" #footer>
          <UpdateProgress
            :received="state.received"
            :size="state.update.size" />
        </template>
      </SettingsField>

      <SettingsField>
        <template #label>Check for updates</template>
        <Switch v-model="checkForUpdates" />
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <SettingsField>
        <template #label>Made by</template>
        <ExternalLink name="c0d3v1l" url="https://michaelnji.codes" />
      </SettingsField>

      <SettingsField>
        <template #label>Welcome</template>
        <template #description>See the setup steps again</template>
        <button type="button" class="pill-button" @click="openSetup">
          Show
        </button>
      </SettingsField>
    </SettingsSection>
  </div>
</template>
