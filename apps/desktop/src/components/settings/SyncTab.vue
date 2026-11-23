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
import { Switch } from "@teneo/ui/components/switch";
import { renderSVG } from "uqr";
import { computed, ref, watch } from "vue";
import AlertCircleIcon from "~icons/tabler/alert-circle";
import CheckIcon from "~icons/tabler/check";
import ChevronRightIcon from "~icons/tabler/chevron-right";
import CopyIcon from "~icons/tabler/copy";
import LaptopIcon from "~icons/tabler/device-laptop";

import { useDelayedBusy } from "@/composables/useDelayedBusy";
import { usePermissionConfirmation } from "@/composables/usePermissionConfirmation";
import { useSettings } from "@/composables/useSettings";
import { messageOf, useSyncStatus } from "@/composables/useSyncStatus";

import PermissionConfirmation from "./PermissionConfirmation.vue";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";
import SettingsStatus from "./SettingsStatus.vue";

const { settings } = useSettings();
const {
  status,
  isBusy,
  error,
  turnOn,
  resume,
  join,
  turnOff,
  setSyncSecrets,
  removeDevice,
  pairingInfo,
  upgradeTrusted,
  rotateTrusted,
  answerEnrollment,
  cancelEnrollment,
} = useSyncStatus();

// --- joining another device's vault

const isJoining = ref(false);
const recoveryCode = ref("");
const { prompt, explain, cancel, confirm } = usePermissionConfirmation();

function confirmSyncAccess(action: string, proceed: () => unknown): void {
  explain(
    {
      title: `${action}?`,
      description:
        "Local Network finds nearby devices; Keychain stores and reads the sync key.",
      action,
    },
    proceed,
  );
}

async function joinWithCode(): Promise<void> {
  if (await join(recoveryCode.value)) {
    recoveryCode.value = "";
    isJoining.value = false;
  }
}

// --- adding a device. The join code unlocks the whole history, so it only
// appears inside this dialog and is dropped when the dialog closes or sync ends.

const isPairingOpen = ref(false);
const pairing = ref<PairingInfo | null>(null);
const isLoadingPairing = ref(false);
const showPairingProgress = useDelayedBusy(isLoadingPairing);
const pairingError = ref("");
const pendingApproval = computed(() =>
  pairing.value ? status.value?.trust?.approval : undefined,
);
const approvalHeading = ref<HTMLElement | null>(null);
watch(approvalHeading, (heading) => heading?.focus(), { flush: "post" });
// two even rows of groups, so the code never breaks in the middle of one
const codeLines = computed(() => {
  const groups = pairing.value?.recoveryCode.split("-") ?? [];
  const half = Math.ceil(groups.length / 2);
  return [groups.slice(0, half).join("-"), groups.slice(half).join("-")];
});
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
  if (status.value?.trust) void cancelEnrollment().catch(() => undefined);
  pairing.value = null;
  pairingError.value = "";
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

const syncState = computed(() => {
  if (status.value?.problem)
    return { label: "Needs attention", tone: "warning" } as const;
  if (!status.value?.running)
    return { label: "Starting", tone: "neutral" } as const;
  if (connectedCount.value === 0)
    return { label: "Looking for devices", tone: "neutral" } as const;
  return { label: "Connected", tone: "success" } as const;
});

const connectedSummary = computed(() => {
  return connectedCount.value === 1
    ? "Syncing with 1 device over Wi-Fi."
    : `Syncing with ${connectedCount.value} devices over Wi-Fi.`;
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
const isUpgradeOpen = ref(false);
const rotation = ref<{ deviceId?: string; name?: string } | null>(null);

async function confirmRotation(): Promise<void> {
  if (!rotation.value) return;
  if (await rotateTrusted(rotation.value.deviceId)) {
    rotation.value = null;
    openDeviceId.value = null;
  }
}

async function respondToEnrollment(accept: boolean): Promise<void> {
  const request = status.value?.trust?.approval;
  if (!request) return;
  pairingError.value = "";
  try {
    await answerEnrollment(request.deviceId, request.fingerprint, accept);
    isPairingOpen.value = false;
  } catch (caught) {
    pairingError.value = messageOf(caught);
  }
}

async function copyInvite(): Promise<void> {
  if (!pairing.value) return;
  try {
    await tiny.clipboard.write({ text: pairing.value.link });
    isCodeCopied.value = true;
  } catch (caught) {
    pairingError.value = messageOf(caught);
  }
}
</script>

<template>
  <div v-if="status" class="grid gap-y-6">
    <!-- sync is off -->
    <template v-if="!status.enabled">
      <SettingsSection>
        <template #section-title>Sync</template>

        <SettingsField>
          <template #label>Sync with your other devices</template>
          <template #description> Over your Wi-Fi, encrypted </template>
          <Button
            size="sm"
            :disabled="isBusy"
            @click="confirmSyncAccess('Turn on sync', turnOn)"
            >Turn on</Button
          >
        </SettingsField>

        <SettingsField>
          <template #label>Join your other devices</template>
          <template #description>
            Use the code or invitation link from another device
          </template>
          <Button
            variant="outline"
            size="sm"
            :disabled="isBusy"
            @click="isJoining = !isJoining">
            {{ isJoining ? "Cancel" : "Join" }}
          </Button>
          <template v-if="isJoining" #footer>
            <form
              class="flex gap-2"
              @submit.prevent="confirmSyncAccess('Join devices', joinWithCode)">
              <Input
                :model-value="recoveryCode"
                placeholder="Join code"
                aria-label="Join code or invitation link"
                autocomplete="off"
                autocapitalize="none"
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
            <p
              v-if="status.trustedJoinFingerprint"
              class="mt-2 text-sm"
              role="status">
              On the primary Mac, approve this device only if the fingerprint
              matches:
              <code>{{ status.trustedJoinFingerprint }}</code>
            </p>
          </template>
        </SettingsField>
      </SettingsSection>
    </template>

    <!-- sync is on -->
    <template v-else>
      <SettingsSection>
        <template #section-title>Sync</template>

        <div class="grid gap-4 px-4 py-4">
          <div
            class="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div class="grid min-w-0 flex-1 basis-72 gap-2">
              <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
                <h4 class="text-sm font-semibold">Sync on this Mac</h4>
                <SettingsStatus :tone="syncState.tone" live>
                  {{ syncState.label }}
                </SettingsStatus>
              </div>
              <p class="text-muted-foreground text-sm">
                <template v-if="status.problem">{{ status.problem }}</template>
                <template v-else-if="!status.running">
                  Waiting for access to the sync key and local network.
                </template>
                <template v-else-if="connectedCount">
                  {{ connectedSummary }}
                </template>
                <template v-else>
                  Keep your devices on the same Wi-Fi network to sync.
                </template>
              </p>
            </div>
            <Button
              v-if="!status.running && status.problem"
              size="sm"
              :disabled="isBusy"
              @click="confirmSyncAccess('Resume sync', resume)">
              Resume sync
            </Button>
          </div>
          <div
            class="border-foreground/10 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t pt-3">
            <div class="flex min-w-0 items-center gap-2.5">
              <LaptopIcon
                aria-hidden="true"
                class="text-muted-foreground size-4 shrink-0" />
              <dl class="min-w-0 text-xs">
                <dt class="text-muted-foreground">Device name</dt>
                <dd class="text-foreground/85 font-medium wrap-break-word">
                  {{ status.deviceName }}
                </dd>
              </dl>
            </div>
            <Button
              variant="ghost"
              size="sm"
              class="text-muted-foreground"
              :disabled="isBusy"
              @click="isTurnOffWarningOpen = true">
              Turn off sync
            </Button>
          </div>
        </div>
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
              <template v-if="device.disconnectedHere">
                · Disconnected here
              </template>
              <template
                v-if="
                  status.trust?.primary &&
                  status.trust.pendingDeviceIds.includes(device.deviceId)
                ">
                · Update pending
              </template>
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

        <SettingsField v-if="!status.trust || status.trust.primary">
          <template #label>Add a device</template>
          <template #description>
            {{
              status.trust
                ? "A one-time invitation"
                : "A QR code and a join code"
            }}
          </template>
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
          <Switch v-model="syncSecrets" :disabled="isBusy" />
        </SettingsField>
      </SettingsSection>
    </template>

    <SettingsSection v-if="status.trustedUpgradeAvailable && !status.trust">
      <template #section-title>Trusted sync · Preview</template>
      <SettingsField>
        <template #label>Make this Mac the primary device</template>
        <template #description>
          Protect sync with individual device keys. Other devices must pair
          again.
        </template>
        <Button
          size="sm"
          variant="outline"
          :disabled="isBusy"
          @click="isUpgradeOpen = true">
          Set up
        </Button>
      </SettingsField>
      <SettingsField v-if="status.enabled">
        <template #label>Join a trusted vault</template>
        <template #description>
          Paste the invitation from the primary Mac. Local history stays here.
        </template>
        <Button
          size="sm"
          variant="outline"
          :disabled="isBusy"
          @click="isJoining = !isJoining">
          {{ isJoining ? "Cancel" : "Join" }}
        </Button>
        <template v-if="isJoining" #footer>
          <form
            class="flex gap-2"
            @submit.prevent="confirmSyncAccess('Join devices', joinWithCode)">
            <Input
              v-model="recoveryCode"
              placeholder="Invitation link"
              aria-label="Trusted vault invitation"
              autocomplete="off"
              spellcheck="false" />
            <Button
              type="submit"
              size="sm"
              :disabled="isBusy || !recoveryCode.trim()">
              Connect
            </Button>
          </form>
          <p
            v-if="status.trustedJoinFingerprint"
            class="mt-2 text-sm"
            role="status">
            On the primary Mac, approve this device only if the fingerprint
            matches:
            <code>{{ status.trustedJoinFingerprint }}</code>
          </p>
        </template>
      </SettingsField>
    </SettingsSection>
    <SettingsSection v-else-if="status.trust?.primary">
      <template #section-title>Trusted sync · Preview</template>
      <SettingsField>
        <template #label>Rotate the sync key</template>
        <template #description>
          Replace the vault key without removing devices.
          <span v-if="status.trust.pendingDeviceIds.length" class="block">
            Waiting for {{ status.trust.pendingDeviceIds.length }} to confirm
            the current key.
          </span>
        </template>
        <Button
          size="sm"
          variant="outline"
          :disabled="isBusy"
          @click="rotation = {}">
          Rotate key
        </Button>
      </SettingsField>
    </SettingsSection>

    <p v-if="error" class="text-destructive text-sm">{{ error }}</p>

    <AlertDialog v-model:open="isPairingOpen">
      <AlertDialogContent
        size="sm"
        class="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 ring-0 data-[size=sm]:max-w-md">
        <AlertDialogHeader
          class="grid-rows-none justify-items-start gap-2 px-6 pt-6 pb-4 text-left">
          <SettingsStatus v-if="pendingApproval" tone="warning">
            Approval required
          </SettingsStatus>
          <AlertDialogTitle>
            <span
              v-if="pendingApproval"
              ref="approvalHeading"
              tabindex="-1"
              class="outline-none">
              Verify the joining device
            </span>
            <template v-else>Add a device</template>
          </AlertDialogTitle>
          <AlertDialogDescription v-if="pendingApproval">
            Approve only if the fingerprint below matches the one in Teneo on
            the joining device.
          </AlertDialogDescription>
          <AlertDialogDescription v-else>
            Scan the QR code with Teneo on your phone. The QR code works once
            and expires after 10 minutes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div class="grid gap-4 overflow-y-auto px-6 pt-1 pb-6">
          <p
            v-if="!pairing && !pairingError"
            role="status"
            class="text-foreground/60 grid min-h-44 place-items-center text-sm">
            {{ showPairingProgress ? "Preparing the pairing code…" : "" }}
          </p>
          <dl
            v-else-if="pendingApproval"
            class="bg-foreground/5 grid gap-2 rounded-lg px-4 py-4">
            <dt class="text-foreground/60 text-xs font-medium">
              Device fingerprint
            </dt>
            <dd class="font-mono text-xl font-semibold tracking-wide">
              {{ pendingApproval.fingerprint }}
            </dd>
          </dl>
          <template v-else-if="pairing">
            <!-- the SVG is made here from the link, never from page input -->
            <div
              role="img"
              aria-label="QR code for adding a device"
              class="mx-auto aspect-square w-full max-w-44 overflow-hidden rounded-lg bg-white p-1 [&>svg]:block [&>svg]:size-full"
              v-html="qrCode" />
            <template v-if="!status.trust && pairing.recoveryCode">
              <div
                class="bg-foreground/5 flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3">
                <div>
                  <p class="text-foreground/60 mb-1 text-xs">Join code</p>
                  <code
                    class="text-foreground/80 font-mono text-xs leading-5 tracking-wide select-none">
                    <span v-for="line in codeLines" :key="line" class="block">
                      {{ line }}
                    </span>
                  </code>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :aria-label="
                    isCodeCopied ? 'Join code copied' : 'Copy join code'
                  "
                  @click="copyRecoveryCode">
                  <CheckIcon v-if="isCodeCopied" />
                  <CopyIcon v-else />
                </Button>
              </div>
              <Alert class="bg-warning/10 dark:bg-warning/15 w-full border-0!">
                <AlertCircleIcon aria-hidden="true" class="text-warning!" />
                <AlertTitle>Keep this code private</AlertTitle>
                <AlertDescription class="text-foreground/60 text-xs">
                  Anyone with it can read your clipboard history.
                </AlertDescription>
              </Alert>
            </template>
          </template>
          <p v-if="pairingError" role="alert" class="text-destructive text-sm">
            {{ pairingError }}
          </p>
        </div>
        <AlertDialogFooter
          class="border-foreground/10 flex-row flex-wrap justify-end border-t px-6 py-4 group-data-[size=sm]/alert-dialog-content:flex">
          <template v-if="pendingApproval">
            <Button variant="outline" @click="respondToEnrollment(false)">
              Reject
            </Button>
            <Button @click="respondToEnrollment(true)">Approve device</Button>
          </template>
          <template v-else>
            <Button
              v-if="pairing && status.trust"
              variant="outline"
              @click="copyInvite">
              {{ isCodeCopied ? "Invitation copied" : "Copy invitation link" }}
            </Button>
            <AlertDialogCancel>Done</AlertDialogCancel>
          </template>
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
          <Button
            v-if="status.trust?.primary"
            variant="outline"
            @click="
              rotation = {
                deviceId: shownDevice.deviceId,
                name: shownDevice.name,
              };
              openDeviceId = null;
            ">
            Revoke and rotate
          </Button>
          <AlertDialogFooter>
            <AlertDialogCancel>Done</AlertDialogCancel>
            <Button
              v-if="!shownDevice.disconnectedHere"
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

    <AlertDialog v-model:open="isUpgradeOpen">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Set up trusted sync?</AlertDialogTitle>
          <AlertDialogDescription>
            History stays, but devices must pair again. Keychain stores the new
            credentials; Local Network finds devices. Losing this Mac means
            starting a new vault.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction :disabled="isBusy" @click="upgradeTrusted()"
            >Set up trusted sync</AlertDialogAction
          >
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog
      :open="rotation !== null"
      @update:open="
        (open) => {
          if (!open) rotation = null;
        }
      ">
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{{
            rotation?.name
              ? `Revoke ${rotation.name} and rotate the key?`
              : "Rotate the sync key?"
          }}</AlertDialogTitle>
          <AlertDialogDescription>
            Keychain saves the new key. Offline devices may still sync until
            they reconnect here. This won’t erase items already shared.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <p v-if="error" class="text-destructive text-sm" role="alert">
          {{ error }}
        </p>
        <AlertDialogFooter>
          <AlertDialogCancel :disabled="isBusy">Cancel</AlertDialogCancel>
          <Button
            :variant="rotation?.deviceId ? 'destructive' : 'default'"
            :disabled="isBusy"
            @click="confirmRotation()">
            {{ rotation?.deviceId ? "Revoke and rotate" : "Rotate key" }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <AlertDialog v-model:open="isTurnOffWarningOpen">
      <AlertDialogContent class="ring-0">
        <AlertDialogHeader>
          <AlertDialogTitle>Turn off sync?</AlertDialogTitle>
          <AlertDialogDescription>
            History stays on this Mac. Keychain access may be needed to remove
            the sync credentials.
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
    <PermissionConfirmation
      :prompt="prompt"
      @cancel="cancel"
      @confirm="confirm" />
  </div>
</template>
