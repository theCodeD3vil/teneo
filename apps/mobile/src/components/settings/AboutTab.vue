<script lang="ts" setup>
import { Button } from "@teneo/ui/components/button";
import { Switch } from "@teneo/ui/components/switch";
import { computed } from "vue";

import { useNavigation } from "../../composables/useNavigation";
import { useSettings } from "../../composables/useSettings";
import { useUpdates } from "../../composables/useUpdates";
import { formatSize } from "../../updates/updater";
import ExternalLink from "./ExternalLink.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const version = __APP_VERSION__;
const { openSetup } = useNavigation();
const { settings, updateSettings } = useSettings();
const { state, check, install, cancel, openInBrowser } = useUpdates();

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
    case "downloading": {
      const percent = Math.floor((now.received / now.update.size) * 100);
      return `Downloading Teneo ${now.update.version}… ${Math.min(percent, 100)}%`;
    }
    case "installing":
      return "Finish in Android's installer";
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
const canUseBrowser = computed(
  () => update.value !== null && state.value.kind !== "downloading",
);
</script>

<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <SettingsField>
        <template #label>Version</template>
        <span class="text-foreground/60 text-sm">{{ version }}</span>
      </SettingsField>

      <SettingsField>
        <template #label>Software update</template>
        <template #description>{{ updateStatus }}</template>
        <Button
          variant="outline"
          size="sm"
          :disabled="action.disabled"
          @click="action.run()">
          {{ action.label }}
        </Button>
        <template v-if="canUseBrowser" #footer>
          <Button
            variant="ghost"
            size="sm"
            class="text-foreground/60 -ml-2"
            @click="openInBrowser()">
            Download in the browser instead
          </Button>
        </template>
      </SettingsField>

      <SettingsField>
        <template #label>Check for updates</template>
        <template #description>
          Look for a new version once a day, when Teneo opens
        </template>
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
        <Button variant="outline" size="sm" @click="openSetup">Show</Button>
      </SettingsField>
    </SettingsSection>
  </div>
</template>
