<script setup lang="ts">
import FeaturesSection from "@/components/FeaturesSection.vue";
import HeroSection from "@/components/HeroSection.vue";
import InstallSection from "@/components/InstallSection.vue";
import RoadmapSection from "@/components/RoadmapSection.vue";
import SiteFooter from "@/components/SiteFooter.vue";
import SiteNavbar from "@/components/SiteNavbar.vue";
</script>

<template>
  <SiteNavbar />
  <main>
    <HeroSection />
    <FeaturesSection />
    <InstallSection />
    <RoadmapSection />
  </main>
  <SiteFooter />
</template>
