<script lang="ts" setup>
import { Button } from "@teneo/ui/components/button";
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";

import { useSettings } from "../../composables/useSettings";
import { useSyncStatus } from "../../composables/useSyncStatus";
import type { PairedDevice } from "../../types/sync";
import ConfirmSheet from "../ConfirmSheet.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();
const { status, isBusy, error, join, turnOff } = useSyncStatus();

const isOn = computed(
  () =>
    status.value !== null &&
    status.value.state !== "off" &&
    status.value.state !== "not_paired",
);

// --- joining the devices of another device's recovery code

const isJoining = ref(false);
const recoveryCode = ref("");

async function joinWithCode(): Promise<void> {
  if (await join(recoveryCode.value)) {
    recoveryCode.value = "";
    isJoining.value = false;
  }
}

// --- what the tab says

const summary = computed(() => {
  if (status.value?.state !== "connected") return "Looking for other devices…";
  const count = status.value.devices.length;
  return count === 1
    ? "Connected to 1 device"
    : `Connected to ${count} devices`;
});

const isConnected = computed(() => status.value?.state === "connected");

const platformName = (device: PairedDevice): string =>
  device.model.startsWith("Mac") ? "Mac" : device.model;

const lastSeen = (device: PairedDevice): string =>
  isConnected.value
    ? "Connected"
    : `Last seen ${new Date(device.lastSeen).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;

const backgroundReceive = computed({
  get: () => settings.value.backgroundReceive,
  set: (enabled) => updateSettings({ backgroundReceive: enabled }),
});

// --- the secrets switch. Turning it on sends API keys to the other devices,
// so it asks first.

const isSecretsWarningOpen = ref(false);
const syncSecrets = computed({
  get: () => settings.value.syncSecrets,
  set: (enabled) => {
    if (enabled) isSecretsWarningOpen.value = true;
    else void updateSettings({ syncSecrets: false });
  },
});

// --- turning sync off forgets this phone's key, so it asks first

const isTurnOffWarningOpen = ref(false);
</script>

<template>
  <div v-if="status" class="mx-auto grid max-w-xl gap-y-6">
    <!-- sync is off -->
    <template v-if="!isOn">
      <SettingsSection>
        <SettingsField>
          <template #label>Join your other devices</template>
          <template #description>
            Use the recovery code from your Mac
          </template>
          <Button
            variant="outline"
            size="sm"
            :disabled="isBusy"
            @click="isJoining = !isJoining">
            {{ isJoining ? "Cancel" : "Join…" }}
          </Button>
          <template v-if="isJoining" #footer>
            <form class="flex gap-2" @submit.prevent="joinWithCode">
              <Input
                :model-value="recoveryCode"
                placeholder="Recovery code"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
                enterkeyhint="go"
                class="font-mono"
                @update:model-value="recoveryCode = String($event)" />
              <Button
                type="submit"
                size="sm"
                class="h-9"
                :disabled="isBusy || !recoveryCode.trim()">
                <Spinner v-if="isBusy" />
                Join
              </Button>
            </form>
          </template>
        </SettingsField>
      </SettingsSection>
      <p class="text-foreground/60 -mt-3 px-1 text-xs text-balance">
        On your Mac, open Teneo's Settings › Sync and choose Add a device to see
        the code. Your history syncs over Wi-Fi, encrypted, with no account or
        server.
      </p>
    </template>

    <!-- sync is on -->
    <template v-else>
      <SettingsSection>
        <SettingsField>
          <template #label>Sync is on</template>
          <template #description>
            {{ summary }}
            <span v-if="status.errorMessage" class="text-destructive block">
              {{ status.errorMessage }}
            </span>
          </template>
          <Spinner v-if="isBusy" />
          <Button
            v-else
            variant="outline"
            size="sm"
            @click="isTurnOffWarningOpen = true">
            Turn off…
          </Button>
        </SettingsField>

        <SettingsField>
          <template #label>Receive in the background</template>
          <template #description>
            Get new items from your other devices while Teneo is closed
          </template>
          <Switch v-model="backgroundReceive" />
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Devices</template>

        <p
          v-if="status.devices.length === 0"
          class="text-foreground/60 px-3 py-2.5 text-sm">
          No other devices yet
        </p>
        <SettingsField v-for="device in status.devices" :key="device.id">
          <template #label>{{ device.name }}</template>
          <template #description>
            {{ platformName(device) }} · {{ lastSeen(device) }}
          </template>
          <span
            v-if="isConnected"
            class="bg-success size-2 rounded-full"
            role="img"
            aria-label="Connected" />
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Privacy</template>

        <SettingsField>
          <template #label>Sync items with secrets</template>
          <template #description>
            Secrets like API keys stay on this phone when off
          </template>
          <Switch v-model="syncSecrets" />
        </SettingsField>
      </SettingsSection>
    </template>

    <p v-if="error" class="text-destructive text-sm">{{ error }}</p>

    <ConfirmSheet
      v-model:open="isTurnOffWarningOpen"
      title="Turn off sync?"
      description="This phone stops syncing but keeps your history. To sync again, use a recovery code from another device."
      confirm-label="Turn off sync"
      @confirm="turnOff()" />

    <ConfirmSheet
      v-model:open="isSecretsWarningOpen"
      title="Sync items with secrets?"
      description="The secrets in your history, and new ones, will be sent to your other devices, encrypted on the way. Turning this off stops new ones but can't take back what a device already has."
      confirm-label="Sync secrets"
      @confirm="updateSettings({ syncSecrets: true })" />
  </div>
</template>
