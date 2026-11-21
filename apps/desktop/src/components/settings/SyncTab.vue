<script lang="ts" setup>
import type { PairingInfo, SyncDevice } from "@teneo/shared/types/sync";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@teneo/ui/components/alert";
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
import AlertCircleIcon from "~icons/tabler/alert-circle";
import CheckIcon from "~icons/tabler/check";
import ChevronRightIcon from "~icons/tabler/chevron-right";
import CopyIcon from "~icons/tabler/copy";

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
  removeDevice,
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
// when asked for, in a modal, and is dropped when the modal closes or sync ends.

const isPairingOpen = ref(false);
const pairing = ref<PairingInfo | null>(null);
const isLoadingPairing = ref(false);
const pairingError = ref("");
// two even rows of groups, so the code never breaks in the middle of one
const codeLines = computed(() => {
  const groups = pairing.value?.recoveryCode.split("-") ?? [];
  const half = Math.ceil(groups.length / 2);
  return [groups.slice(0, half).join("-"), groups.slice(half).join("-")];
});
// The QR code is a one-time key, good for minutes; the join code is the
// vault's own key, for good, so it shows only when asked for
const isCodeShown = ref(false);
const isCodeCopied = ref(false);
const copiedIconTimeout = 1500;
let copiedTimeout: ReturnType<typeof setTimeout> | undefined;

async function showPairing(): Promise<void> {
  isPairingOpen.value = true;
  isLoadingPairing.value = true;
  pairingError.value = "";
  try {
    const info = await pairingInfo();
    // closed while it loaded: don't keep the code
    if (isPairingOpen.value) pairing.value = info;
  } catch (caught) {
    pairingError.value = messageOf(caught);
  } finally {
    isLoadingPairing.value = false;
  }
}

watch(isPairingOpen, (isOpen) => {
  if (isOpen) return;
  pairing.value = null;
  pairingError.value = "";
  isCodeShown.value = false;
  clearTimeout(copiedTimeout);
  isCodeCopied.value = false;
});

// The app's own clipboard write is skipped by the history (onClipboardChange
// in the backend), so the key never lands in the history or gets synced.
async function copyRecoveryCode(): Promise<void> {
  if (!pairing.value) return;
  try {
    await tiny.clipboard.write({ text: pairing.value.recoveryCode });
  } catch (caught) {
    pairingError.value = messageOf(caught);
    return;
  }
  isCodeCopied.value = true;
  clearTimeout(copiedTimeout);
  copiedTimeout = setTimeout(() => {
    isCodeCopied.value = false;
  }, copiedIconTimeout);
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
    if (!enabled) isPairingOpen.value = false;
    if (!enabled) openDeviceId.value = null;
  },
);

// --- what the tab says

const connectedCount = computed(
  () => status.value?.devices.filter((device) => device.connected).length ?? 0,
);

const summary = computed(() => {
  if (!status.value?.running) return "Starting…";
  if (connectedCount.value === 0) return "Looking for other devices…";
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

const dateAndTime = (time: number): string =>
  new Date(time).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const lastSeen = (device: SyncDevice): string => {
  if (device.connected) return "Connected";
  if (device.disconnectedUs) return "Stopped syncing with this Mac";
  return `Last seen ${dateAndTime(device.lastSeenAt)}`;
};

// --- one device: what is known of it, and disconnecting it

const openDeviceId = ref<string | null>(null);
const openDevice = computed(
  () =>
    status.value?.devices.find(
      (device) => device.deviceId === openDeviceId.value,
    ) ?? null,
);
// what the modal shows stays while it closes, and when the device has just
// left the list
const shownDevice = ref<SyncDevice | null>(null);
watch(
  openDevice,
  (device) => {
    if (device) shownDevice.value = device;
  },
  { immediate: true },
);
const isDeviceOpen = computed({
  get: () => openDevice.value !== null,
  set: (isOpen) => {
    if (!isOpen) openDeviceId.value = null;
  },
});
// disconnecting asks first, in the same modal
const isConfirmingDisconnect = ref(false);

function showDevice(device: SyncDevice): void {
  isConfirmingDisconnect.value = false;
  openDeviceId.value = device.deviceId;
}

const titleCase = (text: string): string =>
  text.charAt(0).toUpperCase() + text.slice(1);

const deviceDetails = computed(() => {
  const device = shownDevice.value;
  if (!device) return [];
  const kind = [platformName(device.platform), titleCase(device.maker)]
    .filter(Boolean)
    .join(" · ");
  return [
    { label: "Status", value: lastSeen(device) },
    { label: "Type", value: kind },
    // the port it was reached on says nothing to the user
    { label: "Address", value: device.address?.replace(/:\d+$/, "") ?? "" },
    {
      label: "First connected",
      value: device.pairedAt === null ? "" : dateAndTime(device.pairedAt),
    },
    { label: "Device ID", value: device.deviceId.slice(0, 8).toUpperCase() },
  ].filter((detail) => detail.value);
});

// Only this Mac stops syncing with it: every other device that syncs with
// both still passes items along.
const stillSyncingWith = computed(() => {
  const device = shownDevice.value;
  if (!device) return "";
  const names = (status.value?.devices ?? [])
    .filter(
      (other) => other.deviceId !== device.deviceId && !other.disconnectedUs,
    )
    .map((other) => other.name);
  return new Intl.ListFormat([], { type: "conjunction" }).format(names);
});

async function disconnectDevice(): Promise<void> {
  const device = shownDevice.value;
  if (device && (await removeDevice(device.deviceId))) {
    openDeviceId.value = null;
  }
}

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
          <template #description> Over your Wi-Fi, encrypted </template>
          <Spinner v-if="isBusy" />
          <Button v-else size="sm" @click="turnOn()">Turn on</Button>
        </SettingsField>

        <SettingsField>
          <template #label>Join your other devices</template>
          <template #description>
            Use the join code from another device
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
                class="font-mono"
                @update:model-value="recoveryCode = String($event)" />
              <Button
                type="submit"
                size="sm"
                :disabled="isBusy || !recoveryCode.trim()">
                Connect
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
            <span class="mt-4 block">Shown as “{{ status.deviceName }}”</span>
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
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Devices</template>

        <p
          v-if="status.devices.length === 0"
          class="text-foreground/60 px-3 py-2.5 text-sm">
          No other devices yet
        </p>
        <!-- the row of a SettingsField, as a button: it opens the device -->
        <button
          v-for="device in status.devices"
          :key="device.deviceId"
          type="button"
          class="hover:bg-foreground/5 focus-visible:bg-foreground/5 flex w-full items-center justify-between gap-4 px-3 py-2.5 text-left outline-none"
          @click="showDevice(device)">
          <span class="grid min-w-0 gap-0.5">
            <span class="text-foreground/80 truncate text-sm font-light">
              {{ device.name }}
            </span>
            <span class="text-foreground/60 text-xs">
              {{ platformName(device.platform) }} · {{ lastSeen(device) }}
            </span>
          </span>
          <span class="flex shrink-0 items-center gap-3">
            <span
              v-if="device.connected"
              class="bg-success size-2 rounded-full"
              role="img"
              aria-label="Connected" />
            <ChevronRightIcon class="text-foreground/40 size-4" />
          </span>
        </button>

        <SettingsField>
          <template #label>Add a device</template>
          <template #description> A QR code and a join code </template>
          <Button variant="outline" size="sm" @click="showPairing()">
            Show code
          </Button>
        </SettingsField>
      </SettingsSection>

      <SettingsSection>
        <template #section-title>Privacy</template>

        <SettingsField>
          <template #label>Sync sensitive items</template>
          <template #description>
            Items like API keys stay on this Mac when off
          </template>
          <Spinner v-if="isBusy" />
          <Switch v-else v-model="syncSecrets" />
        </SettingsField>
      </SettingsSection>
    </template>

    <p v-if="error" class="text-destructive text-sm">{{ error }}</p>

    <AlertDialog v-model:open="isPairingOpen">
      <AlertDialogContent size="sm" class="ring-0 data-[size=sm]:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>Add a device</AlertDialogTitle>
        </AlertDialogHeader>
        <div class="grid min-h-44 content-center justify-items-center gap-4">
          <Spinner v-if="isLoadingPairing" />
          <template v-else-if="pairing">
            <!-- the SVG is made here from the link, never from page input -->
            <div
              role="img"
              aria-label="QR code for adding a device"
              class="size-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:block [&>svg]:size-full"
              v-html="qrCode" />
            <p class="text-foreground/60 text-center text-xs">
              Scan it with Teneo on your phone. It works once, for the next 10
              minutes.
            </p>
            <Button
              v-if="!isCodeShown"
              variant="outline"
              size="sm"
              @click="isCodeShown = true">
              Show join code
            </Button>
            <div
              v-if="isCodeShown"
              class="bg-foreground/5 flex w-full items-center justify-center gap-3 rounded-lg px-3 py-3">
              <code
                class="text-foreground/80 font-mono text-xs leading-5 tracking-wide select-none">
                <span v-for="line in codeLines" :key="line" class="block">
                  {{ line }}
                </span>
              </code>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Copy join code"
                @click="copyRecoveryCode">
                <CheckIcon v-if="isCodeCopied" />
                <CopyIcon v-else />
              </Button>
            </div>
            <Alert
              v-if="isCodeShown"
              class="bg-warning/10 dark:bg-warning/15 w-full border-0!">
              <AlertCircleIcon class="text-warning!" />
              <AlertTitle>Keep this code private</AlertTitle>
              <AlertDescription class="text-foreground/60 text-xs">
                Anyone with it can read your clipboard history.
              </AlertDescription>
            </Alert>
          </template>
          <p v-if="pairingError" class="text-destructive text-sm">
            {{ pairingError }}
          </p>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel class="col-span-full">Done</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isDeviceOpen">
      <AlertDialogContent
        v-if="shownDevice"
        size="sm"
        class="ring-0 data-[size=sm]:max-w-md">
        <template v-if="!isConfirmingDisconnect">
          <AlertDialogHeader>
            <AlertDialogTitle>{{ shownDevice.name }}</AlertDialogTitle>
            <AlertDialogDescription v-if="shownDevice.disconnectedUs">
              This device was set to stop syncing with this Mac. To sync with it
              again, turn sync off on either of the two and add it again with a
              code.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <dl class="bg-foreground/5 grid gap-2.5 rounded-lg px-3 py-3 text-sm">
            <div
              v-for="detail in deviceDetails"
              :key="detail.label"
              class="flex items-baseline justify-between gap-4">
              <dt class="text-foreground/60 shrink-0 text-xs">
                {{ detail.label }}
              </dt>
              <dd class="text-foreground/80 min-w-0 truncate text-right">
                {{ detail.value }}
              </dd>
            </div>
          </dl>
          <AlertDialogFooter>
            <AlertDialogCancel>Done</AlertDialogCancel>
            <Button
              variant="destructive"
              @click="isConfirmingDisconnect = true">
              {{ shownDevice.disconnectedUs ? "Remove" : "Disconnect" }}
            </Button>
          </AlertDialogFooter>
        </template>

        <template v-else>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {{ shownDevice.disconnectedUs ? "Remove" : "Disconnect" }}
              {{ shownDevice.name }}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              It and this Mac stop syncing with each other. What each already
              has stays where it is.
              <span v-if="stillSyncingWith" class="mt-2 block">
                It still syncs with {{ stillSyncingWith }}, so new items can
                still pass between it and this Mac that way.
              </span>
              <span class="mt-2 block">
                To sync with it again, turn sync off on either of the two and
                add it again with a code.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p v-if="error" class="text-destructive text-sm">{{ error }}</p>
          <AlertDialogFooter>
            <Button
              variant="outline"
              :disabled="isBusy"
              @click="isConfirmingDisconnect = false">
              Back
            </Button>
            <Button
              variant="destructive"
              :disabled="isBusy"
              @click="disconnectDevice()">
              {{ shownDevice.disconnectedUs ? "Remove" : "Disconnect" }}
            </Button>
          </AlertDialogFooter>
        </template>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isTurnOffWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off sync?</AlertDialogTitle>
          <AlertDialogDescription>
            This Mac stops syncing but keeps your history. To sync again, use a
            join code from another device.
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
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Sync sensitive items?</AlertDialogTitle>
          <AlertDialogDescription>
            The secrets in your history, and new ones, will be sent to your
            other devices, encrypted on the way. Turning this off stops new ones
            but can't take back what a device already has.
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
