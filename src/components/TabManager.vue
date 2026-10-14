<script setup lang="ts">
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { omit } from "@/utils/helpers";

import { clipboardItemVariants, type TabVariant } from "../types/clipboard";

const tabValues: TabVariant[] = omit(clipboardItemVariants, "empty");
const defaultTab = tabValues[0];
</script>

<template>
  <Tabs class="w-full bg-transparent!" :default-value="defaultTab">
    <TabsList class="w-full justify-start gap-x-3 bg-transparent!">
      <div v-for="tabItem in tabValues" :key="tabItem">
        <TabsTrigger
          class="data-active:bg-primary/10! bg-muted/60 data-active:text-primary! data-active:border-primary/80! text-xs font-light capitalize"
          :value="tabItem">
          {{ tabItem }}
        </TabsTrigger>
      </div>
    </TabsList>
    <TabsContent value="account">
      Make changes to your account here.
    </TabsContent>
    <TabsContent value="password"> Change your password here. </TabsContent>
  </Tabs>
</template>
