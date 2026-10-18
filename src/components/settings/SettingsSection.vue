<template>
  <section class="grid gap-y-3">
    <h3 class="font-medium">
      <slot name="section-title" />
    </h3>
    <!-- one SettingsField per setting; divide-y separates however many there are -->
    <div class="divide-foreground/10 bg-foreground/5 grid divide-y rounded-lg">
      <slot />
    </div>
  </section>
</template>
