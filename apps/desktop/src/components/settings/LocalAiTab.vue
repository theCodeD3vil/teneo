<script setup lang="ts">
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@teneo/ui/components/alert";
import { Button } from "@teneo/ui/components/button";
import { Switch } from "@teneo/ui/components/switch";
import { computed, onMounted, ref } from "vue";
import AlertCircleIcon from "~icons/tabler/alert-circle";

import BetaBadge from "@/components/BetaBadge.vue";
import TransferProgress from "@/components/TransferProgress.vue";
import { useHistoryProtection } from "@/composables/useHistoryProtection";
import {
  localAiStatusFailed,
  refreshLocalAi,
  useLocalAi,
} from "@/composables/useLocalAi";
import type { LocalAiModelStatus } from "@/types/local-ai";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
import SettingsStatus from "./SettingsStatus.vue";

const emit = defineEmits<{ openSecurity: [] }>();
const status = useLocalAi();
const { status: protection } = useHistoryProtection();
const unavailableHistory = computed(() => {
  if (protection.value?.locked)
    return {
      title: "Saved secrets are locked",
      action: "Choose Unlock in Security, then copy the item again.",
    };
  if (protection.value?.needsKeychainAccess)
    return {
      title: "Saved secrets are unavailable",
      action: "Choose Restore access in Security, then copy the item again.",
    };
  if (protection.value?.unreadable)
    return {
      title: "Saved secrets are unavailable",
      action: "Check the encryption status in Security.",
    };
  return null;
});

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

function isVerifying(entry: LocalAiModelStatus): boolean {
  return entry.bytes > 0 && entry.downloadedBytes >= entry.bytes;
}

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
  <Alert
    v-if="unavailableHistory"
    class="border-warning/30 bg-warning/10 dark:bg-warning/15 mb-4">
    <AlertCircleIcon aria-hidden="true" class="text-warning!" />
    <AlertTitle>{{ unavailableHistory.title }}</AlertTitle>
    <AlertDescription class="text-foreground/75 text-xs">
      <p>
        New copies containing detected secrets aren’t saved to history while
        Teneo can’t encrypt them. {{ unavailableHistory.action }}
      </p>
      <Button
        variant="outline"
        size="sm"
        class="mt-2 w-fit"
        @click="emit('openSecurity')">
        Open Security
      </Button>
    </AlertDescription>
  </Alert>
  <div v-if="status" class="grid gap-y-6">
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
    </SettingsSection>
    <SettingsSection>
      <template #section-title>Models</template>
      <SettingsField v-for="entry in models" :key="entry.id">
        <template #label>{{ entry.name }}</template>
        <template #status>
          <SettingsStatus
            v-if="!entry.downloading"
            :tone="entry.installed ? 'success' : 'neutral'"
            live>
            {{ entry.installed ? "Installed" : "Not installed" }}
          </SettingsStatus>
        </template>
        <template #description> {{ formatSizeMb(entry.bytes) }} MB </template>
        <Button
          v-if="entry.installed"
          variant="ghost"
          size="sm"
          class="text-muted-foreground"
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
        <template v-if="entry.downloading" #footer>
          <TransferProgress
            :label="isVerifying(entry) ? 'Verifying…' : 'Downloading…'"
            :progress-label="`Download progress for ${entry.name}`"
            :received="entry.downloadedBytes || undefined"
            :total="entry.bytes"
            :finalizing="isVerifying(entry)" />
        </template>
      </SettingsField>
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
  <p v-else-if="localAiStatusFailed" role="status" class="px-3 text-sm">
    Couldn’t reach the Local AI backend. Restart Teneo Debug and try again.
  </p>
  <p v-else role="status" class="px-3 text-sm">
    Waiting for the Local AI backend…
  </p>
</template>
