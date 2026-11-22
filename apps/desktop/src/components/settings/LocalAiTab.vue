<script setup lang="ts">
import { Button } from "@teneo/ui/components/button";
import { Switch } from "@teneo/ui/components/switch";
import { computed, onMounted, ref } from "vue";

import BetaBadge from "@/components/BetaBadge.vue";
import {
  localAiStatusFailed,
  refreshLocalAi,
  useLocalAi,
} from "@/composables/useLocalAi";
import type { LocalAiModelStatus } from "@/types/local-ai";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const status = useLocalAi();
onMounted(() => {
  if (!status.value?.available) void refreshLocalAi();
});
const busy = ref(false);
const error = ref("");

const models = computed<readonly LocalAiModelStatus[]>(() => {
  const value = status.value;
  if (!value) return [];
  if (value.models?.length) return value.models;
  return [
    {
      id: value.model.id,
      name: value.model.name,
      role: "general",
      description: "Local inference model",
      bytes: value.model.bytes,
      available: value.available,
      installed: value.installed,
      downloading: value.downloading,
      downloadedBytes: value.downloadedBytes,
    },
  ];
});

const activeDownload = computed(() =>
  models.value.find((entry) => entry.downloading),
);
const progress = computed(() => {
  const active = activeDownload.value;
  return active && active.bytes > 0
    ? Math.floor((active.downloadedBytes / active.bytes) * 100)
    : 0;
});

function formatSizeMb(bytes: number): number {
  return Math.round(bytes / 1e6);
}

async function change(
  action: "localAiDownload" | "localAiEnable" | "localAiRemove",
  call: () => Promise<unknown>,
) {
  if (busy.value) return;
  busy.value = true;
  error.value = "";
  try {
    await call();
  } catch {
    error.value =
      action === "localAiDownload"
        ? "The download couldn’t be completed or verified. Try again."
        : action === "localAiRemove"
          ? "The downloaded model couldn’t be removed."
          : "The downloaded model couldn’t be verified. Try downloading it again.";
  } finally {
    busy.value = false;
  }
}

const download = (id: string) =>
  change("localAiDownload", () => tiny.api.call("localAiDownload", { id }));
const setEnabled = (enabled: boolean) =>
  change("localAiEnable", () => tiny.api.call("localAiEnable", { enabled }));
const remove = (id: string) =>
  change("localAiRemove", () => tiny.api.call("localAiRemove", { id }));
</script>

<template>
  <div v-if="status" class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title><span>Local AI</span> <BetaBadge /></template>
      <SettingsField>
        <template #label>Use Local AI</template>
        <template #description>
          Classifies possible credentials behind the scenes and checks preview
          actions. Runs on this Mac.
        </template>
        <Switch
          :model-value="status.optedIn"
          :disabled="
            busy ||
            status.downloading ||
            (!status.optedIn && (!status.available || !status.installed))
          "
          aria-label="Use Local AI"
          @update:model-value="setEnabled" />
      </SettingsField>
      <SettingsField v-for="entry in models" :key="entry.id">
        <template #label>{{ entry.name }}</template>
        <template #description>
          {{ formatSizeMb(entry.bytes) }} MB ·
          {{ entry.installed ? "Installed" : "Not installed" }} ·
          {{ entry.description }}
        </template>
        <Button
          v-if="entry.installed"
          variant="outline"
          size="sm"
          :disabled="busy || status.downloading"
          @click="remove(entry.id)">
          Remove
        </Button>
        <Button
          v-else
          variant="outline"
          size="sm"
          :disabled="!entry.available || busy || status.downloading"
          @click="download(entry.id)">
          Download
        </Button>
      </SettingsField>
      <div v-if="activeDownload" class="grid gap-2 px-3 py-2 text-sm">
        <span role="status">
          {{
            progress >= 100
              ? `Verifying ${activeDownload.name}…`
              : `Downloading ${activeDownload.name}…`
          }}
        </span>
        <progress
          aria-label="Model download progress"
          class="accent-primary w-full"
          :value="progress"
          max="100" />
      </div>
      <p v-if="error" role="alert" class="text-destructive px-3 py-2 text-sm">
        {{ error }}
      </p>
      <p
        v-if="!status.available || (status.optedIn && !status.installed)"
        role="status"
        class="px-3 py-2 text-sm">
        The sandboxed runner isn’t ready.
        <template v-if="status.optedIn">
          Teneo still treats likely credential values as sensitive.
        </template>
        <template v-if="!status.available">
          To build the runner, run <code>bun run local-ai:build</code> from
          <code>apps/desktop</code>, then reopen this tab.
        </template>
      </p>
    </SettingsSection>
    <p class="text-foreground/70 px-3 text-xs">
      Possible credentials follow your existing Security and Sync settings.
      Detection can make mistakes and does not rescan older history.
    </p>
  </div>
  <p
    v-else-if="localAiStatusFailed"
    role="status"
    class="mx-auto max-w-xl px-3 text-sm">
    Couldn’t reach the Local AI backend. Restart Teneo Debug and try again.
  </p>
  <p v-else role="status" class="mx-auto max-w-xl px-3 text-sm">
    Waiting for the Local AI backend…
  </p>
</template>
