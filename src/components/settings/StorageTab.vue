<script lang="ts" setup>
import { useMutation } from "@tanstack/vue-query";
import { computed, ref } from "vue";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useDataFolderUsage } from "@/composables/useDataFolderUsage";
import { useSettings } from "@/composables/useSettings";
import { formatFileSize } from "@/utils/file-size";

import type { ClipboardItemKind } from "../../../shared/types/clipboard";
import type {
  AppSettings,
  HistoryDuration,
} from "../../../shared/types/settings";
import SettingsField from "./SettingsField.vue";
import SettingsSection from "./SettingsSection.vue";

const durationOptions: { value: HistoryDuration; label: string }[] = [
  { value: "day", label: "1 day" },
  { value: "week", label: "1 week" },
  { value: "month", label: "1 month" },
  { value: "year", label: "1 year" },
  { value: "forever", label: "forever" },
];

// 0 = no limit
const maximumItemsOptions = [
  { value: 100, label: "100" },
  { value: 500, label: "500" },
  { value: 1000, label: "1,000" },
  { value: 0, label: "Unlimited" },
];

const { settings, updateSettings } = useSettings();

const historyDuration = computed({
  get: () => settings.value.historyDuration,
  set: (duration) =>
    changeHistoryLimit({ historyDuration: duration as HistoryDuration }),
});

// <select> values are strings; the setting is a number
const maximumItems = computed({
  get: () => String(settings.value.maximumItems),
  set: (value) => changeHistoryLimit({ maximumItems: Number(value) }),
});

// Base 1000, like the sizes shown elsewhere; 0 = no limit
const maximumStorageOptions = [
  { value: 100e6, label: "100 MB" },
  { value: 500e6, label: "500 MB" },
  { value: 1e9, label: "1 GB" },
  { value: 5e9, label: "5 GB" },
  { value: 0, label: "Unlimited" },
];

const maximumStorage = computed({
  get: () => String(settings.value.maximumStorage),
  set: (value) => changeHistoryLimit({ maximumStorage: Number(value) }),
});

// A tighter limit deletes history as soon as it's saved, so it waits here
// until the user confirms. null = nothing waiting.
const pendingLimitChange = ref<{
  changes: Partial<AppSettings>;
  itemCount: number;
} | null>(null);
// Bumped to re-render the selects, so a cancelled choice snaps back
const limitSelectRevision = ref(0);

async function changeHistoryLimit(
  changes: Partial<AppSettings>,
): Promise<void> {
  const itemCount: number = await tiny.api.call("countItemsDeletedBy", {
    changes,
  });
  if (itemCount === 0) void updateSettings(changes);
  else pendingLimitChange.value = { changes, itemCount };
}

function confirmLimitChange(): void {
  const change = pendingLimitChange.value;
  pendingLimitChange.value = null;
  if (change) void updateSettings(change.changes);
}

const isLimitWarningOpen = computed({
  get: () => pendingLimitChange.value !== null,
  set: (open) => {
    // closed without confirming (Cancel, Esc)
    if (open || !pendingLimitChange.value) return;
    pendingLimitChange.value = null;
    limitSelectRevision.value += 1;
  },
});

const limitWarningTitle = computed(() => {
  const itemCount = pendingLimitChange.value?.itemCount ?? 0;
  return `Delete ${itemCount} ${itemCount === 1 ? "item" : "items"}?`;
});

const { usage, usageError } = useDataFolderUsage();

// Same colors as each kind's icon on the clipboard cards; colors get their
// own so they're told apart from images
const storageSegmentKinds: Array<{
  kind: ClipboardItemKind;
  label: string;
  colorClass: string;
}> = [
  { kind: "image", label: "Images", colorClass: "bg-primary" },
  { kind: "files", label: "Files", colorClass: "bg-warning" },
  { kind: "text", label: "Text", colorClass: "bg-success" },
  { kind: "color", label: "Colors", colorClass: "bg-info" },
];

const clipboardSize = computed(() =>
  usage.value
    ? Object.values(usage.value.clipboardSizeByKind).reduce(
        (total, bytes) => total + bytes,
        0,
      )
    : 0,
);

// The bar's full width is the limit, or, with no limit, what's used
const storageSegments = computed(() => {
  if (!usage.value) return [];
  const barBytes = settings.value.maximumStorage || clipboardSize.value;
  return storageSegmentKinds
    .map((segment) => {
      const bytes = usage.value?.clipboardSizeByKind[segment.kind] ?? 0;
      const percent = barBytes > 0 ? (bytes / barBytes) * 100 : 0;
      return { ...segment, bytes, percent: Math.min(percent, 100) };
    })
    .filter((segment) => segment.bytes > 0);
});

// How full the item limit is. While a tighter limit waits for confirmation,
// it shows that limit, so the ring matches the choice in the select.
const itemLimitUsage = computed(() => {
  const limit =
    pendingLimitChange.value?.changes.maximumItems ??
    settings.value.maximumItems;
  if (!usage.value || limit === 0) return null;
  const count = usage.value.itemCount;
  const percent = Math.min(Math.round((count / limit) * 100), 100);
  return {
    percent,
    label: `${count.toLocaleString()} of ${limit.toLocaleString()} items (${percent}%)`,
  };
});

const storageLimitSummary = computed(() => {
  const used = formatFileSize(clipboardSize.value);
  const limit = settings.value.maximumStorage;
  return limit > 0
    ? `${used} of ${formatFileSize(limit)} used by clipboard history`
    : `${used} used by clipboard history`;
});

const contentSummary = computed(() => {
  if (!usage.value) return "";
  const pluralRules = new Intl.PluralRules();
  const describe = (count: number, one: string, other: string) =>
    `${count} ${pluralRules.select(count) === "one" ? one : other}`;
  return `${describe(usage.value.imageCount, "image", "images")} · ${describe(
    usage.value.fileCount,
    "file",
    "files",
  )} from your clipboard`;
});

const clearHistoryMutation = useMutation({
  mutationFn: (): Promise<void> => tiny.api.call("clearHistory"),
});
</script>
<template>
  <div class="mx-auto grid max-w-xl gap-y-6">
    <SettingsSection>
      <template #section-title>History</template>

      <SettingsField>
        <template #label>Keep history for</template>
        <template #description>
          Older items are deleted automatically; pinned items stay
        </template>
        <NativeSelect
          :key="`duration-${limitSelectRevision}`"
          v-model="historyDuration"
          class="capitalize!"
          size="sm">
          <NativeSelectOption
            v-for="duration in durationOptions"
            :key="duration.value"
            :value="duration.value"
            class="capitalize!">
            {{ duration.label }}
          </NativeSelectOption>
        </NativeSelect>
      </SettingsField>

      <SettingsField>
        <template #label>Maximum items</template>
        <template #description>
          The oldest items go first; pinned items don't count
        </template>
        <div class="flex items-center gap-3">
          <!-- pathLength=100 makes the dash offset a percentage -->
          <TooltipProvider v-if="itemLimitUsage">
            <Tooltip>
              <TooltipTrigger as-child>
                <svg
                  viewBox="0 0 24 24"
                  class="size-6 shrink-0 -rotate-90"
                  role="progressbar"
                  :aria-valuenow="itemLimitUsage.percent"
                  aria-valuemin="0"
                  aria-valuemax="100"
                  :aria-label="itemLimitUsage.label">
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke-width="3"
                    class="stroke-foreground/10" />
                  <circle
                    v-if="itemLimitUsage.percent > 0"
                    cx="12"
                    cy="12"
                    r="9"
                    fill="none"
                    stroke-width="3"
                    stroke-linecap="round"
                    pathLength="100"
                    stroke-dasharray="100"
                    :style="{ strokeDashoffset: 100 - itemLimitUsage.percent }"
                    class="stroke-primary transition-[stroke-dashoffset] duration-300 ease-out" />
                </svg>
              </TooltipTrigger>
              <TooltipContent>
                {{ itemLimitUsage.percent }}% used
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <NativeSelect
            :key="`items-${limitSelectRevision}`"
            v-model="maximumItems"
            size="sm">
            <NativeSelectOption
              v-for="option in maximumItemsOptions"
              :key="option.value"
              :value="String(option.value)">
              {{ option.label }}
            </NativeSelectOption>
          </NativeSelect>
        </div>
      </SettingsField>
    </SettingsSection>

    <SettingsSection>
      <template #section-title>Data</template>

      <SettingsField>
        <template #label>Storage used</template>
        <template #description>
          <span v-if="usageError && !usage" class="text-destructive">
            Couldn't read the data folder
          </span>
          <template v-else-if="usage">{{ contentSummary }}</template>
          <template v-else>Measuring…</template>
        </template>
        <span v-if="usage" class="text-foreground/60 text-sm tabular-nums">
          {{ formatFileSize(usage.size) }}
        </span>
        <Spinner v-else-if="!usageError" class="text-foreground/60" />
        <template v-if="usage" #footer>
          <div class="grid gap-2">
            <div
              role="img"
              :aria-label="storageLimitSummary"
              class="bg-foreground/10 flex h-1.5 gap-px overflow-hidden rounded-full">
              <div
                v-for="segment in storageSegments"
                :key="segment.kind"
                class="h-full transition-[width] duration-300"
                :class="segment.colorClass"
                :style="{ width: `${segment.percent}%` }" />
            </div>
            <div
              class="text-foreground/60 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums">
              <span
                v-for="segment in storageSegments"
                :key="segment.kind"
                class="flex items-center gap-1.5">
                <span class="size-2 rounded-full" :class="segment.colorClass" />
                {{ segment.label }} {{ formatFileSize(segment.bytes) }}
              </span>
            </div>
          </div>
        </template>
      </SettingsField>

      <SettingsField>
        <template #label>Storage limit</template>

        <NativeSelect
          :key="`storage-${limitSelectRevision}`"
          v-model="maximumStorage"
          size="sm">
          <NativeSelectOption
            v-for="option in maximumStorageOptions"
            :key="option.value"
            :value="String(option.value)">
            {{ option.label }}
          </NativeSelectOption>
        </NativeSelect>
      </SettingsField>

      <SettingsField disabled>
        <template #label>Data folder</template>
        <template #description>
          Where Teneo keeps your history and saved images
        </template>
        <Button variant="outline" size="sm">Show in Finder</Button>
      </SettingsField>

      <SettingsField>
        <template #label>Clear history</template>
        <template #description>
          <span
            v-if="clearHistoryMutation.isError.value"
            class="text-destructive">
            Couldn't clear history
          </span>
          <template v-else>
            Delete every item and saved image, except pinned items
          </template>
        </template>
        <AlertDialog>
          <AlertDialogTrigger as-child>
            <Button
              variant="destructive"
              size="sm"
              :disabled="clearHistoryMutation.isPending.value">
              Clear history
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent class="bg-card/35 border-card/45">
            <AlertDialogHeader>
              <AlertDialogTitle>Clear clipboard history?</AlertDialogTitle>
              <AlertDialogDescription>
                Every item and saved image will be deleted, except pinned items.
                This can't be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                @click="clearHistoryMutation.mutate()">
                Clear history
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </SettingsField>
    </SettingsSection>

    <AlertDialog v-model:open="isLimitWarningOpen">
      <AlertDialogContent class="bg-card/35 border-card/45">
        <AlertDialogHeader>
          <AlertDialogTitle>{{ limitWarningTitle }}</AlertDialogTitle>
          <AlertDialogDescription>
            The new limit deletes your oldest clipboard history right away,
            along with any saved images. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" @click="confirmLimitChange">
            Delete and apply
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>
