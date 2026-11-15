<script lang="ts" setup>
import { Button } from "@teneo/ui/components/button";
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref } from "vue";
import ScanIcon from "~icons/tabler/scan";

import { canScanQrCode, useQrScanner } from "../../composables/useQrScanner";
import { useSettings } from "../../composables/useSettings";
import { useSyncStatus } from "../../composables/useSyncStatus";
import type { PairedDevice } from "../../types/sync";
import ConfirmSheet from "../ConfirmSheet.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();
const { status, isBusy, error, notice, join, turnOff } = useSyncStatus();

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

const { scan, isPreparing, isScanning } = useQrScanner();
const scanError = ref("");

async function scanAndJoin(): Promise<void> {
  scanError.value = "";
  try {
    const code = await scan();
    if (code) await join(code);
  } catch (caught) {
    scanError.value = caught instanceof Error ? caught.message : String(caught);
  }
}

// --- what the tab says

const summary = computed(() => {
  if (status.value?.state === "error") return "Not syncing";
  if (status.value?.state !== "connected") return "Looking for other devices…";
  const count = status.value.devices.filter(
    (device) => device.connected,
  ).length;
  return count === 1
    ? "Connected to 1 device"
    : `Connected to ${count} devices`;
});

const lastSeen = (device: PairedDevice): string =>
  device.connected
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
        <SettingsField v-if="canScanQrCode">
          <template #label>Join your other devices</template>
          <template #description>Scan the QR code on your Mac</template>
          <Button
            size="sm"
            :disabled="isBusy || isScanning"
            @click="scanAndJoin">
            <Spinner v-if="isPreparing || (isBusy && !isJoining)" />
            <ScanIcon v-else />
            Scan
          </Button>
        </SettingsField>
        <SettingsField>
          <template #label>
            {{
              canScanQrCode ? "Type the join code" : "Join your other devices"
            }}
          </template>
          <template #description>
            {{
              canScanQrCode
                ? "If the camera can't be used"
                : "Use the join code from your Mac"
            }}
          </template>
          <Button
            variant="outline"
            size="sm"
            :disabled="isBusy"
            @click="isJoining = !isJoining">
            {{ isJoining ? "Cancel" : "Join" }}
          </Button>
          <template v-if="isJoining" #footer>
            <form class="flex gap-2" @submit.prevent="joinWithCode">
              <Input
                :model-value="recoveryCode"
                placeholder="Join code"
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
                Connect
              </Button>
            </form>
          </template>
        </SettingsField>
      </SettingsSection>
      <p class="text-foreground/60 -mt-3 px-1 text-xs text-balance">
        On your Mac, open Teneo's Settings › Sync and choose Add a device to see
        the {{ canScanQrCode ? "QR code and join code" : "code" }}. Your history
        syncs over Wi-Fi, encrypted, with no account or server.
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
            Turn off
          </Button>
        </SettingsField>

        <SettingsField>
          <template #label>Receive in the background</template>
          <template #description>
            Get new items while the app is closed
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
            {{ device.platform }} · {{ lastSeen(device) }}
          </template>
          <span
            v-if="device.connected"
            class="bg-success size-2 rounded-full"
            role="img"
            aria-label="Connected" />
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Privacy</template>

        <SettingsField>
          <template #label>Sync sensitive items</template>
          <Switch v-model="syncSecrets" />
        </SettingsField>
      </SettingsSection>
    </template>

    <p v-if="scanError || error" class="text-destructive text-sm">
      {{ scanError || error }}
    </p>
    <p v-else-if="notice && !isOn" class="text-foreground/60 text-sm">
      {{ notice }}
    </p>

    <ConfirmSheet
      v-model:open="isTurnOffWarningOpen"
      title="Turn off sync?"
      description="This phone stops syncing but keeps your history. To sync again, scan the QR code or use the join code from another device."
      confirm-label="Turn off sync"
      @confirm="turnOff()" />

    <ConfirmSheet
      v-model:open="isSecretsWarningOpen"
      title="Sync sensitive items?"
      description="The secrets in your history, and new ones, will be sent to your other devices, encrypted. What's already sent can't be taken back."
      confirm-label="Sync secrets"
      @confirm="updateSettings({ syncSecrets: true })" />
  </div>
</template>
