<template>
  <section class="grid gap-y-[0.625rem]">
    <h3 v-if="$slots['section-title']" class="group-label px-2">
      <slot name="section-title" />
    </h3>
    <!-- one SettingsField per setting; divide-y separates however many there are -->
    <div class="divide-hairline bg-card grid divide-y rounded-[1.5rem]">
      <slot />
    </div>
  </section>
</template>
