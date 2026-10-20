<script setup lang="ts">
// Photo: iccup on Unsplash (https://unsplash.com/photos/xNtwmcRP-gw)
import heroImage from "@/assets/hero-clouds.jpg";
</script>

<template>
  <section id="top" class="relative min-h-svh w-full overflow-hidden">
    <img
      :src="heroImage"
      alt=""
      fetchpriority="high"
      class="absolute inset-0 size-full object-cover object-[center_38%]" />
  </section>
</template>
