<script setup lang="ts">
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@teneo/ui/components/alert-dialog";
import { Button } from "@teneo/ui/components/button";

import type { PermissionExplanation } from "@/composables/usePermissionConfirmation";

defineProps<{ prompt: PermissionExplanation | null }>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
</script>

<template>
  <AlertDialog
    :open="prompt !== null"
    @update:open="
      (open) => {
        if (!open) emit('cancel');
      }
    ">
    <AlertDialogContent v-if="prompt">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ prompt.title }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          {{ prompt.description }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <Button @click="emit('confirm')">{{ prompt.action }}</Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
