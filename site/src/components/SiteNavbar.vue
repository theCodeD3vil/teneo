<script setup lang="ts">
import { ExternalLinkIcon, Menu01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/vue";
import { useResizeObserver } from "@vueuse/core";
import { ref, useTemplateRef } from "vue";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useActiveSection } from "@/composables/useActiveSection";
import { useGithubStars } from "@/composables/useGithubStars";

const REPO = "theCodeD3vil/teneo";
const REPO_URL = `https://github.com/${REPO}`;

const links = [
  { label: "Features", href: "#features" },
  { label: "Install", href: "#install" },
  { label: "Docs", href: `${REPO_URL}#readme`, external: true },
];

const stars = useGithubStars(REPO);

const activeSection = useActiveSection(
  links.filter((link) => !link.external).map((link) => link.href.slice(1)),
);
const isActive = (href: string) => href === `#${activeSection.value}`;

// Refraction width in px, and how far the backdrop is pulled at the very edge.
const BEZEL = 15;
const MAX_SHIFT = 16;

// Only Chromium accepts `url()` inside `backdrop-filter`; elsewhere the CSS falls back to clear glass.
const refractive = (
  navigator as Navigator & { userAgentData?: { brands: { brand: string }[] } }
).userAgentData?.brands.some(({ brand }) => brand === "Chromium");

const nav = useTemplateRef<HTMLElement>("nav");
const displacement = ref({ url: "", width: 0, height: 0 });

// Red/green channels encode, per pixel, how far to pull the backdrop inward from the pill's rim.
function buildDisplacementMap(width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d")!;
  const image = context.createImageData(width, height);
  const radius = height / 2;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const offsetX =
        x + 0.5 - Math.min(Math.max(x + 0.5, radius), width - radius);
      const offsetY = y + 0.5 - radius;
      const distanceFromCore = Math.hypot(offsetX, offsetY);
      const depth = (radius - distanceFromCore) / BEZEL;
      const strength =
        depth >= 1 || distanceFromCore === 0 ? 0 : (1 - depth) ** 2.5;
      const index = (y * width + x) * 4;

      image.data[index] =
        128 - (offsetX / (distanceFromCore || 1)) * strength * 127;
      image.data[index + 1] =
        128 - (offsetY / (distanceFromCore || 1)) * strength * 127;
      image.data[index + 2] = 128;
      image.data[index + 3] = 255;
    }
  }

  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

useResizeObserver(nav, () => {
  const { offsetWidth: width, offsetHeight: height } = nav.value!;
  if (
    !refractive ||
    (width === displacement.value.width && height === displacement.value.height)
  ) {
    return;
  }
  displacement.value = {
    url: buildDisplacementMap(width, height),
    width,
    height,
  };
});
</script>

<template>
  <header class="fixed inset-x-0 top-3 z-50 px-3 sm:top-4 sm:px-4">
    <svg
      v-if="refractive"
      aria-hidden="true"
      class="pointer-events-none absolute size-0">
      <filter id="teneo-liquid-glass" color-interpolation-filters="sRGB">
        <feImage
          :href="displacement.url"
          x="0"
          y="0"
          :width="displacement.width"
          :height="displacement.height"
          preserveAspectRatio="none"
          result="map" />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          :scale="MAX_SHIFT * 2"
          xChannelSelector="R"
          yChannelSelector="G" />
      </filter>
    </svg>

    <nav
      ref="nav"
      aria-label="Primary"
      class="glass mx-auto grid max-w-4xl grid-cols-[1fr_auto_1fr] items-center rounded-full py-2 pr-2 pl-3.5"
      :class="{ 'glass-refract': refractive && displacement.url }">
      <a href="#top" class="flex items-center gap-2.5 justify-self-start">
        <img src="/favicon.svg" alt="" class="size-8" />
        <span class="text-base font-semibold tracking-tight">Teneo</span>
      </a>

      <ul class="hidden items-center gap-0.5 md:flex">
        <li v-for="link in links" :key="link.label">
          <a
            :href="link.href"
            :target="link.external ? '_blank' : undefined"
            :rel="link.external ? 'noopener noreferrer' : undefined"
            :aria-current="isActive(link.href) ? 'location' : undefined"
            :class="
              isActive(link.href)
                ? 'text-primary bg-white'
                : 'text-foreground/80 hover:bg-foreground/8 hover:text-foreground'
            "
            class="block rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors">
            {{ link.label }}
          </a>
        </li>
      </ul>

      <div class="col-start-3 flex items-center gap-1 justify-self-end">
        <Button
          as="a"
          :href="REPO_URL"
          target="_blank"
          rel="noopener noreferrer"
          :aria-label="stars ? `GitHub, ${stars} stars` : 'GitHub'"
          class="h-9 rounded-full bg-white px-3.5 text-black hover:bg-neutral-100">
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
            class="size-4.5">
            <path
              d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
          </svg>
          <span>GitHub</span>
          <template v-if="stars">
            <span class="tabular-nums">{{ stars }}</span>
            <span class="grid size-4 *:col-start-1 *:row-start-1">
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linejoin="round"
                aria-hidden="true"
                class="size-4 text-yellow-400 transition-all duration-200 group-hover/button:scale-50 group-hover/button:rotate-45 group-hover/button:opacity-0">
                <polygon
                  points="12 2.5 14.9 8.9 21.9 9.6 16.6 14.3 18.2 21.2 12 17.6 5.8 21.2 7.4 14.3 2.1 9.6 9.1 8.9" />
              </svg>
              <HugeiconsIcon
                :icon="ExternalLinkIcon"
                class="size-4 scale-50 -rotate-45 opacity-0 transition-all duration-200 group-hover/button:scale-100 group-hover/button:rotate-0 group-hover/button:opacity-100" />
            </span>
          </template>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open menu"
              class="hover:bg-foreground/8 rounded-full md:hidden">
              <HugeiconsIcon :icon="Menu01Icon" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            :side-offset="12"
            class="min-w-44 rounded-2xl p-1.5">
            <DropdownMenuItem
              v-for="link in links"
              :key="link.label"
              as-child
              class="rounded-xl">
              <a
                :href="link.href"
                :target="link.external ? '_blank' : undefined"
                :rel="link.external ? 'noopener noreferrer' : undefined">
                {{ link.label }}
              </a>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </nav>
  </header>
</template>

<style scoped>
/* Liquid glass: near-clear body, light blur, and soft specular edges that read as a bevel. */
.glass {
  --glass-fill: oklch(1 0 0 / 0.14);
  --glass-edge: oklch(1 0 0 / 0.18);
  --glass-highlight: oklch(1 0 0 / 0.4);
  --glass-highlight-soft: oklch(1 0 0 / 0.2);
  --glass-glow: oklch(1 0 0 / 0.06);
  --glass-hairline: oklch(0 0 0 / 0.07);
  --glass-drop: oklch(0 0 0 / 0.18);

  position: relative;
  background: var(--glass-fill);
  -webkit-backdrop-filter: blur(10px) saturate(1.8) brightness(1.06);
  backdrop-filter: blur(10px) saturate(1.8) brightness(1.06);
  box-shadow:
    inset 0 0 0 0.5px var(--glass-edge),
    inset 2px 3px 2px -2px var(--glass-highlight),
    inset -2px -3px 2px -2px var(--glass-highlight-soft),
    inset 0 0 22px var(--glass-glow),
    0 0 0 0.5px var(--glass-hairline),
    0 1px 2px oklch(0 0 0 / 0.08),
    0 14px 34px -10px var(--glass-drop);
}

/* The SVG displacement filter bends the backdrop along the rim, like light through a glass bead. */
.glass-refract {
  backdrop-filter: url(#teneo-liquid-glass) blur(1px) saturate(1.8)
    brightness(1.06);
}

/* Specular rim: a 1px ring lit from the top-left and bottom-right corners. */
.glass::before {
  content: "";
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: linear-gradient(
    135deg,
    var(--glass-highlight),
    transparent 30%,
    transparent 70%,
    var(--glass-highlight-soft)
  );
  -webkit-mask:
    linear-gradient(#000 0 0) content-box,
    linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask:
    linear-gradient(#000 0 0) content-box exclude,
    linear-gradient(#000 0 0);
  pointer-events: none;
}

:global(.dark) .glass {
  --glass-fill: oklch(1 0 0 / 0.06);
  --glass-edge: oklch(1 0 0 / 0.1);
  --glass-highlight: oklch(1 0 0 / 0.3);
  --glass-highlight-soft: oklch(1 0 0 / 0.15);
  --glass-glow: oklch(1 0 0 / 0.03);
  --glass-hairline: oklch(0 0 0 / 0.35);
  --glass-drop: oklch(0 0 0 / 0.55);
}

@supports not (backdrop-filter: blur(1px)) {
  .glass {
    background: var(--background);
  }
}
</style>
