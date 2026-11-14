<script lang="ts" setup>
import type { PairingInfo, SyncDevice } from "@teneo/shared/types/sync";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@teneo/ui/components/alert-dialog";
import { Button } from "@teneo/ui/components/button";
import { Input } from "@teneo/ui/components/input";
import { Spinner } from "@teneo/ui/components/spinner";
import { Switch } from "@teneo/ui/components/switch";
import { renderSVG } from "uqr";
import { computed, ref, watch } from "vue";

import { useSettings } from "@/composables/useSettings";
import { messageOf, useSyncStatus } from "@/composables/useSyncStatus";

import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const { settings } = useSettings();
const {
  status,
  isBusy,
  error,
  turnOn,
  join,
  turnOff,
  setSyncSecrets,
  pairingInfo,
} = useSyncStatus();

// --- joining another device's vault

const isJoining = ref(false);
const recoveryCode = ref("");

async function joinWithCode(): Promise<void> {
  if (await join(recoveryCode.value)) {
    recoveryCode.value = "";
    isJoining.value = false;
  }
}

// --- adding a device. The code unlocks the whole history, so it shows only
// when asked for, and goes away when sync does.

const pairing = ref<PairingInfo | null>(null);
const isLoadingPairing = ref(false);
const pairingError = ref("");

async function showPairing(): Promise<void> {
  isLoadingPairing.value = true;
  pairingError.value = "";
  try {
    pairing.value = await pairingInfo();
  } catch (caught) {
    pairingError.value = messageOf(caught);
  } finally {
    isLoadingPairing.value = false;
  }
}

// scanners need dark on light, whatever the theme
const qrCode = computed(() =>
  pairing.value
    ? renderSVG(pairing.value.link, {
        ecc: "M",
        border: 2,
        whiteColor: "#ffffff",
        blackColor: "#000000",
      })
    : "",
);

watch(
  () => status.value?.enabled,
  (enabled) => {
    if (!enabled) pairing.value = null;
  },
);

// --- what the tab says

const connectedCount = computed(
  () => status.value?.devices.filter((device) => device.connected).length ?? 0,
);

const summary = computed(() => {
  if (!status.value?.running) return "Starting…";
  if (connectedCount.value === 0) return "Looking for your other devices…";
  return connectedCount.value === 1
    ? "Connected to 1 device"
    : `Connected to ${connectedCount.value} devices`;
});

const platformNames: Record<string, string> = {
  mac: "Mac",
  android: "Android",
  ios: "iPhone",
  dev: "Test device",
};
const platformName = (platform: string): string =>
  platformNames[platform] ?? platform;

const lastSeen = (device: SyncDevice): string =>
  device.connected
    ? "Connected"
    : `Last seen ${new Date(device.lastSeenAt).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })}`;

// --- the secrets switch. Turning it on sends API keys to the other devices,
// so it asks first.

const isSecretsWarningOpen = ref(false);
const syncSecrets = computed({
  get: () => settings.value.syncSecrets,
  set: (enabled) => {
    if (enabled) isSecretsWarningOpen.value = true;
    else void setSyncSecrets(false);
  },
});

// --- turning sync off forgets this Mac's key, so it asks first

const isTurnOffWarningOpen = ref(false);
</script>

<template>
  <div v-if="status" class="mx-auto grid max-w-xl gap-y-6">
    <!-- sync is off -->
    <template v-if="!status.enabled">
      <SettingsSection>
        <template #section-title>Sync</template>

        <SettingsField>
          <template #label>Sync with your other devices</template>
          <template #description>
            Keep your clipboard history in step across your devices over your
            Wi-Fi. It is encrypted between them, goes through no server, and
            needs no account.
          </template>
          <Spinner v-if="isBusy" />
          <Button v-else size="sm" @click="turnOn()">Turn on</Button>
        </SettingsField>

        <SettingsField>
          <template #label>Join your other devices</template>
          <template #description>
            Enter the recovery code from a device that already syncs.
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
                class="font-mono"
                @update:model-value="recoveryCode = String($event)" />
              <Button
                type="submit"
                size="sm"
                :disabled="isBusy || !recoveryCode.trim()">
                Join
              </Button>
            </form>
          </template>
        </SettingsField>
      </SettingsSection>
    </template>

    <!-- sync is on -->
    <template v-else>
      <SettingsSection>
        <template #section-title>Sync</template>

        <SettingsField>
          <template #label>Sync is on</template>
          <template #description>
            {{ summary }}
            <span v-if="status.problem" class="text-destructive block">
              {{ status.problem }}
            </span>
            <span class="block">
              Shown to your other devices as “{{ status.deviceName }}”
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
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Devices</template>

        <p
          v-if="status.devices.length === 0"
          class="text-foreground/60 px-3 py-2.5 text-sm">
          No other devices yet. Add one below.
        </p>
        <SettingsField v-for="device in status.devices" :key="device.deviceId">
          <template #label>{{ device.name }}</template>
          <template #description>
            {{ platformName(device.platform) }} · {{ lastSeen(device) }}
          </template>
          <span
            v-if="device.connected"
            class="bg-success size-2 rounded-full"
            role="img"
            aria-label="Connected" />
        </SettingsField>

        <SettingsField>
          <template #label>Add a device</template>
          <template #description>
            Scan the QR code with Teneo on your phone, or type the recovery code
            on another Mac. Anyone who has it can read your clipboard history.
          </template>
          <Spinner v-if="isLoadingPairing" />
          <Button
            v-else
            variant="outline"
            size="sm"
            @click="pairing ? (pairing = null) : showPairing()">
            {{ pairing ? "Hide" : "Show code" }}
          </Button>
          <template v-if="pairing || pairingError" #footer>
            <p v-if="pairingError" class="text-destructive text-xs">
              {{ pairingError }}
            </p>
            <div
              v-else-if="pairing"
              class="grid justify-items-center gap-3 pt-2">
              <!-- the SVG is made here from the link, never from page input -->
              <div
                role="img"
                aria-label="QR code for adding a device"
                class="size-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:block [&>svg]:size-full"
                v-html="qrCode" />
              <code
                class="text-foreground/80 text-center font-mono text-sm tracking-wide break-all select-all">
                {{ pairing.recoveryCode }}
              </code>
            </div>
          </template>
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Privacy</template>

        <SettingsField>
          <template #label>Sync items with secrets</template>
          <template #description>
            API keys and other secrets Teneo finds in what you copy stay on this
            Mac unless you turn this on.
          </template>
          <Spinner v-if="isBusy" />
          <Switch v-else v-model="syncSecrets" />
        </SettingsField>
      </SettingsSection>
    </template>

    <p v-if="error" class="text-destructive text-sm">{{ error }}</p>

    <AlertDialog v-model:open="isTurnOffWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off sync?</AlertDialogTitle>
          <AlertDialogDescription>
            This Mac stops syncing and forgets its sync key and the devices it
            was paired with. Your history stays here, and so does whatever your
            other devices already have. To sync again, join with a recovery code
            from a device that still has sync on.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="turnOff()">
            Turn off sync
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isSecretsWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>Sync items with secrets?</AlertDialogTitle>
          <AlertDialogDescription>
            The API keys and other secrets already in your history will be sent
            to your other devices, and so will new ones. They are encrypted on
            the way. Turning this off again stops new ones, but can't take back
            what a device already has.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            @click="setSyncSecrets(true)">
            Sync secrets
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
