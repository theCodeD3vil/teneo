<script lang="ts" setup>
import { useEventListener } from "@vueuse/core";
import { computed, onUnmounted, ref } from "vue";
import CancelIcon from "~icons/hugeicons/cancel-01";

import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { getShortcutLabels, readShortcut } from "@/utils/shortcuts";

/** the shortcut as a tinyjs combo, "" when none is set */
const shortcut = defineModel<string>({ required: true });
const emit = defineEmits<{ error: [message: string | null] }>();

const isRecording = ref(false);
const shortcutLabels = computed(() => getShortcutLabels(shortcut.value));

function setRecording(recording: boolean): void {
  if (isRecording.value === recording) return;
  isRecording.value = recording;
  emit("error", null);
  // Release the current shortcut while recording, so pressing it again
  // reaches this page instead of opening the panel
  void tiny.api.call("pauseOpenPanelShortcut", { paused: recording });
}

function recordShortcut(event: KeyboardEvent): void {
  if (!isRecording.value) return;
  event.preventDefault();
  event.stopPropagation();

  if (event.code === "Escape") {
    setRecording(false);
    return;
  }
  const recording = readShortcut(event);
  if (recording.status === "invalid") emit("error", recording.reason);
  if (recording.status !== "complete") return;

  shortcut.value = recording.shortcut;
  setRecording(false);
}

// Capture phase, so the keys never reach anything else on the page
useEventListener(window, "keydown", recordShortcut, { capture: true });
// Recording only makes sense while this window has the keyboard
useEventListener(window, "blur", () => setRecording(false));
onUnmounted(() => setRecording(false));
</script>

<template>
  <div class="flex items-center gap-1">
    <Button
      variant="outline"
      size="sm"
      :class="{ 'ring-ring/50 ring-3': isRecording }"
      @click="setRecording(!isRecording)">
      <span v-if="isRecording" class="text-foreground/60">Press keys…</span>
      <span v-else-if="shortcut" class="flex items-center gap-1">
        <Kbd
          v-for="label in shortcutLabels"
          :key="label"
          class="bg-foreground/10">
          {{ label }}
        </Kbd>
      </span>
      <span v-else>Record shortcut</span>
    </Button>
    <Button
      v-if="shortcut && !isRecording"
      variant="ghost"
      size="icon-xs"
      aria-label="Remove shortcut"
      @click="shortcut = ''">
      <CancelIcon />
    </Button>
  </div>
</template>
