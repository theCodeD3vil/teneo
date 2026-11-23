<template>
  <section class="grid gap-y-2.5">
    <h3 class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
      <slot name="section-title" />
    </h3>
    <!-- one SettingsField per setting; divide-y separates however many there are -->
    <div
      class="divide-foreground/10 bg-foreground/5 dark:bg-foreground/6 grid divide-y rounded-lg">
      <slot />
    </div>
  </section>
</template>
