<script setup lang="ts">
import { watch } from "vue";

import { useClipboardItem } from "../../composables/useClipboard";
import { useNavigation } from "../../composables/useNavigation";
import ItemPreview from "./ItemPreview.vue";

const props = defineProps<{
  itemId: string;
}>();

const { goBack } = useNavigation();
const { item, isGone } = useClipboardItem(() => props.itemId);

watch(isGone, (gone) => {
  if (gone) goBack();
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <ItemPreview v-if="item" :item="item" @back="goBack" />
  </div>
</template>
