<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { omit } from "@/utils/helpers";

import { clipboardItemVariants, type TabVariant } from "../types/clipboard";
import AllTabContent from "./AllTabContent.vue";

const tabValues: TabVariant[] = omit(clipboardItemVariants, "empty");
const defaultTab = tabValues[0];
</script>

<template>
  <Tabs
    class="min-h-0 w-full flex-1 bg-transparent!"
    :default-value="defaultTab">
    <TabsList class="sticky top-0 w-full justify-start gap-x-3 bg-transparent!">
      <div v-for="tabItem in tabValues" :key="tabItem">
        <TabsTrigger
          class="data-active:bg-primary/10! bg-foreground/5 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
    </TabsList>
    <TabsContent value="all" class="mt-3 min-h-0 flex-1 bg-transparent!">
      <AllTabContent />
    </TabsContent>
  </Tabs>
</template>
