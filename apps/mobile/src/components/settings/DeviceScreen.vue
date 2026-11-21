<script setup lang="ts">
import { Spinner } from "@teneo/ui/components/spinner";
import { computed, ref, watch } from "vue";
import DeviceIcon from "~icons/tabler/devices";

import { useNavigation } from "../../composables/useNavigation";
import { useSyncStatus } from "../../composables/useSyncStatus";
import type { PairedDevice } from "../../types/sync";
import ConfirmSheet from "../ConfirmSheet.vue";
import SettingsHeader from "./SettingsHeader.vue";
import SettingsSection from "./SettingsSection.vue";

/** One paired device: what is known of it, and disconnecting it. */
const props = defineProps<{
  deviceId: string;
}>();

const { status, isBusy, error, disconnect } = useSyncStatus();
const { goBack } = useNavigation();

const current = computed(
  () =>
    status.value?.devices.find((device) => device.id === props.deviceId) ??
    null,
);
// what the screen shows stays while it leaves, once the device is gone from
// the list
const device = ref<PairedDevice | null>(null);
watch(
  current,
  (found) => {
    if (found) device.value = found;
  },
  { immediate: true },
);

const dateAndTime = (time: number): string =>
  new Date(time).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });

const statusLine = computed(() => {
  if (!device.value) return "";
  if (device.value.connected) return "Connected";
  if (device.value.disconnectedUs) return "Stopped syncing with this phone";
  return `Last seen ${dateAndTime(device.value.lastSeen)}`;
});

const details = computed(() => {
  const shown = device.value;
  if (!shown) return [];
  return [
    {
      label: "Type",
      value: [shown.platform, shown.maker].filter(Boolean).join(" · "),
    },
    { label: "Address", value: shown.address },
    {
      label: "First connected",
      value: shown.firstSeen > 0 ? dateAndTime(shown.firstSeen) : "",
    },
    { label: "Device ID", value: shown.id.slice(0, 8).toUpperCase() },
  ].filter((detail) => detail.value);
});

// --- disconnecting asks first: it is only undone by pairing again

const isWarningOpen = ref(false);
const action = computed(() =>
  device.value?.disconnectedUs ? "Remove" : "Disconnect",
);

// Only this phone stops syncing with it: every other device that syncs with
// both still passes items along
const warning = computed(() => {
  const shown = device.value;
  if (!shown) return "";
  const others = (status.value?.devices ?? [])
    .filter((other) => other.id !== shown.id && !other.disconnectedUs)
    .map((other) => other.name);
  const stillSyncing =
    others.length > 0
      ? ` It still syncs with ${new Intl.ListFormat([], { type: "conjunction" }).format(others)}, so new items can still pass between it and this phone that way.`
      : "";
  return `It and this phone stop syncing with each other. What each already has stays where it is.${stillSyncing} To sync with it again, turn sync off on either of the two and add it again with a code.`;
});

async function disconnectDevice(): Promise<void> {
  if (await disconnect(props.deviceId)) goBack();
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <SettingsHeader back-label="Back to sync">
      <span class="screen-title min-w-0 break-words">
        {{ device?.name ?? "Device" }}
      </span>
    </SettingsHeader>
    <div
      v-if="device"
      class="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-4">
      <div class="mx-auto grid max-w-xl gap-y-5">
        <div
          class="bg-card flex items-center gap-[0.875rem] rounded-[1.5rem] px-[1.125rem] py-4">
          <span
            class="grid size-[2.75rem] shrink-0 place-items-center rounded-[0.875rem]"
            :class="
              device.connected
                ? 'bg-tint-blue text-tint-blue-ink'
                : 'bg-tint-neutral text-tint-neutral-ink'
            ">
            <DeviceIcon class="size-[1.375rem]" />
          </span>
          <span class="min-w-0 flex-1 text-sm font-semibold">
            {{ statusLine }}
          </span>
          <span
            v-if="device.connected"
            class="bg-success ring-tint-mint mr-1 size-[0.625rem] rounded-full ring-[5px]"
            role="img"
            aria-label="Connected" />
        </div>

        <SettingsSection>
          <template #section-title>Details</template>
          <div
            v-for="detail in details"
            :key="detail.label"
            class="flex min-h-[3.5rem] items-center justify-between gap-4 px-[1.125rem] py-3">
            <span class="text-muted-foreground shrink-0 text-sm">
              {{ detail.label }}
            </span>
            <span class="min-w-0 truncate text-right text-sm font-semibold">
              {{ detail.value }}
            </span>
          </div>
        </SettingsSection>

        <p class="text-muted-foreground px-2 text-xs leading-[1.3125rem]">
          <template v-if="device.disconnectedUs">
            This device was set to stop syncing with this phone. To sync with it
            again, turn sync off on either of the two and add it again with a
            code.
          </template>
          <template v-else>
            Disconnecting stops sync between this phone and this device only.
            Your other devices carry on.
          </template>
        </p>

        <button
          type="button"
          class="pill-button text-destructive h-[3.25rem] w-full"
          :disabled="isBusy"
          @click="isWarningOpen = true">
          <Spinner v-if="isBusy" />
          {{ action }}
        </button>

        <p v-if="error" class="text-destructive px-2 text-sm">{{ error }}</p>
      </div>
    </div>

    <ConfirmSheet
      v-model:open="isWarningOpen"
      :title="`${action} ${device?.name ?? 'this device'}?`"
      :description="warning"
      :confirm-label="action"
      @confirm="disconnectDevice()" />
  </div>
</template>
