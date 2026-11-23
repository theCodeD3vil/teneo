<script lang="ts" setup>
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { computed, ref, watch } from "vue";
import GoIcon from "~icons/tabler/arrow-right";
import ChevronIcon from "~icons/tabler/chevron-right";
import DeviceIcon from "~icons/tabler/devices";
import ScanIcon from "~icons/tabler/scan";

import { useNavigation } from "../../composables/useNavigation";
import { canScanQrCode, useQrScanner } from "../../composables/useQrScanner";
import { useSettings } from "../../composables/useSettings";
import { useSyncStatus } from "../../composables/useSyncStatus";
import type { PairedDevice } from "../../types/sync";
import ConfirmSheet from "../ConfirmSheet.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings, updateSettings } = useSettings();
const { status, isBusy, error, notice, join, turnOff } = useSyncStatus();
const { openDevice } = useNavigation();

const isOn = computed(
  () =>
    status.value !== null &&
    status.value.state !== "off" &&
    status.value.state !== "not_paired",
);

// --- joining the devices of another device's recovery code

const isJoining = ref(false);
const recoveryCode = ref("");
const replacementCode = ref("");
const isReplacementOpen = ref(false);

async function connect(code: string, replaceExisting = false): Promise<void> {
  if (await join(code, { replaceExisting })) {
    recoveryCode.value = "";
    isJoining.value = false;
  }
}

async function requestJoin(code: string): Promise<void> {
  if (isBusy.value || !code.trim()) return;
  error.value = "";
  scanError.value = "";
  if (isOn.value) {
    replacementCode.value = code;
    isReplacementOpen.value = true;
  } else {
    await connect(code);
  }
}

watch(isReplacementOpen, (open) => {
  if (!open) replacementCode.value = "";
});

const { scan, isPreparing, isScanning } = useQrScanner();
const scanError = ref("");

async function scanAndJoin(): Promise<void> {
  scanError.value = "";
  try {
    const code = await scan();
    if (code) await requestJoin(code);
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

const lastSeen = (device: PairedDevice): string => {
  if (device.connected) return "Connected";
  if (device.disconnectedUs) return "Stopped syncing with this phone";
  return `Last seen ${new Date(device.lastSeen).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  })}`;
};

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
  <div v-if="status" class="mx-auto grid max-w-xl gap-y-5">
    <!-- sync is off -->
    <template v-if="!isOn && canScanQrCode">
      <div class="grid gap-y-3">
        <!-- scanning is the quick way in, so it leads -->
        <div
          class="bg-panel text-panel-foreground flex flex-col gap-5 rounded-[2rem] p-6">
          <span
            class="grid size-[3.25rem] place-items-center rounded-[1.125rem] bg-white/12">
            <ScanIcon aria-hidden="true" class="size-[1.625rem]" />
          </span>
          <div class="grid gap-1">
            <span
              class="font-heading text-[1.5rem] leading-[1.875rem] font-semibold">
              Join your other devices
            </span>
            <span class="text-panel-muted text-[1rem] leading-[1.5rem]">
              Scan the QR code on your Mac
            </span>
          </div>
          <button
            type="button"
            class="font-heading text-foreground dark:text-background flex h-[3.5rem] items-center justify-between rounded-full bg-white pr-1.5 pl-6 text-[1.125rem] font-semibold transition-transform active:scale-[0.98] disabled:opacity-60"
            :disabled="isBusy || isScanning"
            @click="scanAndJoin">
            Scan
            <span
              class="bg-primary text-primary-foreground grid size-[2.75rem] place-items-center rounded-full">
              <Spinner v-if="isPreparing || (isBusy && !isJoining)" />
              <GoIcon v-else aria-hidden="true" class="size-[1.25rem]" />
            </span>
          </button>
        </div>
      </div>
    </template>

    <!-- sync is on -->
    <template v-else-if="isOn">
      <div
        class="bg-panel text-panel-foreground flex items-center gap-4 rounded-[2rem] py-5 pr-5 pl-6">
        <div class="grid min-w-0 flex-1 gap-0.5">
          <span
            class="font-heading text-[1.375rem] leading-[1.75rem] font-semibold">
            Sync is on
          </span>
          <span class="text-panel-muted text-[0.9375rem] leading-[1.375rem]">
            {{ summary }}
            <span v-if="status.errorMessage" class="block text-[#ff9a8f]">
              {{ status.errorMessage }}
            </span>
          </span>
        </div>
        <button
          type="button"
          class="h-[2.75rem] shrink-0 rounded-full border border-white/35 px-[1.125rem] text-[0.9375rem] font-semibold active:bg-white/10 disabled:opacity-60"
          :disabled="isBusy || isScanning"
          @click="isTurnOffWarningOpen = true">
          Turn off
        </button>
      </div>

      <SettingsSection v-if="status.enrollmentFingerprint">
        <SettingsField>
          <template #label>Waiting for approval</template>
          <template #description>
            On the primary Mac, approve this phone only if this fingerprint
            matches.
            <code class="mt-1 block font-semibold" role="status">{{
              status.enrollmentFingerprint
            }}</code>
          </template>
          <Spinner />
        </SettingsField>
      </SettingsSection>
    </template>

    <SettingsSection v-if="!status.enrollmentFingerprint">
      <template v-if="isOn" #section-title>Join another device</template>
      <SettingsField v-if="isOn && canScanQrCode">
        <template #label>Scan a QR code</template>
        <template #description>Use the invitation shown on your Mac</template>
        <button
          type="button"
          class="pill-button min-h-12"
          :disabled="isBusy || isScanning"
          @click="scanAndJoin">
          <Spinner v-if="isPreparing" aria-hidden="true" />
          Scan
        </button>
      </SettingsField>
      <SettingsField>
        <template #label>
          {{ canScanQrCode ? "Type the join code" : "Join your other devices" }}
        </template>
        <template #description>
          Use the join code or invitation link from your Mac
        </template>
        <button
          type="button"
          class="pill-button min-h-12"
          :disabled="isBusy || isScanning"
          :aria-expanded="isJoining"
          @click="isJoining = !isJoining">
          {{ isJoining ? "Cancel" : "Join" }}
        </button>
        <template v-if="isJoining" #footer>
          <form
            class="flex flex-wrap gap-2"
            @submit.prevent="requestJoin(recoveryCode)">
            <Input
              :model-value="recoveryCode"
              placeholder="Code or invitation link"
              aria-label="Join code or invitation link"
              autocomplete="off"
              autocapitalize="none"
              spellcheck="false"
              enterkeyhint="go"
              class="bg-well border-input min-h-12 min-w-0 flex-1 basis-40 rounded-full px-[1.125rem] font-mono text-[1rem]"
              @update:model-value="recoveryCode = String($event)" />
            <button
              type="submit"
              class="pill-button bg-cta text-cta-foreground min-h-12 border-transparent"
              :disabled="isBusy || isScanning || !recoveryCode.trim()">
              Connect
            </button>
          </form>
        </template>
      </SettingsField>
      <p
        v-if="scanError || error"
        role="alert"
        class="text-destructive px-[1.125rem] py-3 text-sm">
        {{ scanError || error }}
      </p>
    </SettingsSection>
    <p
      v-if="!isOn"
      class="text-muted-foreground px-2 text-xs leading-[1.3125rem]">
      On your Mac, open Teneo’s Settings › Sync and choose Add a device to see
      the {{ canScanQrCode ? "QR code and join code" : "code" }}. Your history
      syncs over Wi-Fi, encrypted, with no account or server.
    </p>

    <template v-if="isOn">
      <SettingsSection>
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
          class="text-muted-foreground px-[1.125rem] py-4 text-sm">
          No other devices yet
        </p>
        <!-- a device opens its own screen: what is known of it, and
             disconnecting it -->
        <button
          v-for="device in status.devices"
          :key="device.id"
          type="button"
          class="active:bg-muted flex items-center gap-[0.875rem] px-[1.125rem] py-[0.875rem] text-left first:rounded-t-[1.5rem] last:rounded-b-[1.5rem]"
          @click="openDevice(device.id)">
          <span
            class="grid size-[2.75rem] shrink-0 place-items-center rounded-[0.875rem]"
            :class="
              device.connected
                ? 'bg-tint-blue text-tint-blue-ink'
                : 'bg-tint-neutral text-tint-neutral-ink'
            ">
            <DeviceIcon class="size-[1.375rem]" />
          </span>
          <div class="grid min-w-0 flex-1 gap-0.5">
            <span class="truncate text-sm font-semibold">{{
              device.name
            }}</span>
            <span class="text-muted-foreground text-xs">
              {{ device.platform }} · {{ lastSeen(device) }}
            </span>
          </div>
          <span
            v-if="device.connected"
            class="bg-success ring-tint-mint mr-1 size-[0.625rem] rounded-full ring-[5px]"
            role="img"
            aria-label="Connected" />
          <ChevronIcon class="text-muted-foreground size-[1.125rem] shrink-0" />
        </button>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Privacy</template>

        <SettingsField>
          <template #label>Sync sensitive items</template>
          <Switch v-model="syncSecrets" />
        </SettingsField>
      </SettingsSection>
    </template>

    <p
      v-if="!isOn && status.errorMessage"
      class="text-destructive px-2 text-sm"
      role="alert">
      {{ status.errorMessage }}
    </p>
    <p v-else-if="notice && !isOn" class="text-muted-foreground px-2 text-sm">
      {{ notice }}
    </p>

    <ConfirmSheet
      v-model:open="isReplacementOpen"
      title="Replace this phone’s sync pairing?"
      description="Your clipboard history stays on this phone, but it forgets its current sync key and devices before joining. If the invitation doesn’t work, you’ll need a new code to reconnect."
      confirm-label="Replace and join"
      @confirm="connect(replacementCode, true)" />

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
