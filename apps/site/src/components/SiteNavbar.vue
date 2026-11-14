<script setup lang="ts">
import ExternalLinkIcon from "~icons/tabler/external-link";
import MenuIcon from "~icons/tabler/menu-2";

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
  { label: "Roadmap", href: "#roadmap" },
  { label: "Docs", href: `${REPO_URL}#readme`, external: true },
];

const stars = useGithubStars(REPO);

const activeSection = useActiveSection(
  links.filter((link) => !link.external).map((link) => link.href.slice(1)),
);
const isActive = (href: string) => href === `#${activeSection.value}`;
</script>

<template>
  <header class="fixed inset-x-0 top-3 z-50 px-3 sm:top-4 sm:px-4">
    <!-- Frosted glass: a mostly opaque tint over a heavy blur, so the dark text
         keeps its contrast whether the content behind is dark or light. -->
    <nav
      aria-label="Primary"
      class="mx-auto grid max-w-4xl grid-cols-[1fr_auto_1fr] items-center rounded-full bg-white/30 py-2 pr-2 pl-3.5 shadow-lg ring-1 shadow-black/10 ring-black/8 backdrop-blur-md backdrop-saturate-150">
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
                ? 'text-primary bg-white shadow-sm'
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
              <ExternalLinkIcon
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
              <MenuIcon />
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
