<script setup lang="ts">
import SiteFooter from "@/components/SiteFooter.vue";

// The policy Google Play links to from Teneo's listing, and the one for the
// Mac app. Every statement here is about what the apps do: change the app,
// change this page, and the date with it.
const UPDATED = "16 November 2026";
const ISSUES_URL = "https://github.com/theCodeD3vil/teneo/issues";

type Block = string | { list: string[] };

const sections: Array<{ title: string; blocks: Block[] }> = [
  {
    title: "What Teneo keeps, and where",
    blocks: [
      "Teneo is a clipboard manager, so it saves what you copy. All of it is kept on the device you copied it on:",
      {
        list: [
          "On a Mac: the text, images, files and colors you copy, the name of the app each came from, and when.",
          "On Android: text and images you share to Teneo with “Save to Teneo”, and, only if you turn it on, what is on the clipboard when you open the app.",
          "Your settings, and which items you pinned.",
        ],
      },
      "This history never goes to us. We have no servers that receive it, and Teneo has no accounts to sign in to. On Android it is also left out of Google's device backups.",
    ],
  },
  {
    title: "Sync between your own devices",
    blocks: [
      "Sync is off until you turn it on. When it is on, your devices send each other your history directly, over your own Wi-Fi or local network. Nothing goes through a server of ours or anyone else's.",
      "Everything synced is end-to-end encrypted with a key that only your devices hold. A device gets that key when you pair it, by scanning a QR code or typing a recovery code. We never have it.",
      "Text and images sync; files do not. Items that look like API keys or passwords stay on the device they were copied on unless you choose to sync them. Paired devices also tell each other their name and maker, and the icons of the apps you copied from, so each item can show where it came from.",
    ],
  },
  {
    title: "When Teneo uses the internet",
    blocks: [
      "Teneo connects to the internet for these things only:",
      {
        list: [
          "Link previews. When you copy a link, Teneo fetches that page's name, icon and picture from the site itself, not through any other service. The site sees a visit from your internet address, as it would if you opened the link. Teneo never opens sign-in, password-reset or one-time links, or addresses on your local network. You can turn previews off in Settings.",
          "Updates. The Mac app, and the Android app installed from GitHub, ask GitHub whether a newer version exists and download it from GitHub. GitHub sees your internet address when they do. You can turn the check off in Settings. The Android app installed from Google Play is updated by Google Play instead.",
          "Scanning a QR code on Android. This uses Google's code scanner, which is part of Google Play services on your phone. Teneo receives only what the code says, and does not ask for the camera permission.",
        ],
      },
    ],
  },
  {
    title: "API keys and passwords",
    blocks: [
      "Teneo looks for API keys, private keys and passwords in what you copy so it can hide them in your history. It does this on your device, and never sends them anywhere. On a Mac, anything copied from a password manager is skipped, and you can have saved keys encrypted with a key kept in your macOS Keychain.",
    ],
  },
  {
    title: "What Teneo does not do",
    blocks: [
      {
        list: [
          "No analytics, crash reporting or usage tracking.",
          "No advertising, and no advertising identifiers.",
          "No selling or sharing of your data: we never receive it.",
        ],
      },
    ],
  },
  {
    title: "Permissions",
    blocks: [
      "On Android, Teneo asks to show notifications (the one that says sync is running), to keep sync running in the background, and to start it again after the phone restarts. On a Mac, it asks for Accessibility so it can paste for you, and for the folders you copy files from so it can show their previews. None of these send anything off your device.",
    ],
  },
  {
    title: "Deleting your data",
    blocks: [
      "Your history is yours to remove at any time: delete single items, set how long history is kept and how many items, or uninstall Teneo, which removes everything it stored on that device. As we hold none of your data, there is nothing for us to delete.",
    ],
  },
  {
    title: "This website",
    blocks: [
      "This site sets no cookies and has no analytics. It loads its font from Google Fonts and the project's star count from GitHub, so Google and GitHub see your internet address when you visit, as does the company that hosts the site.",
    ],
  },
  {
    title: "Children",
    blocks: [
      "Teneo is a general-purpose tool and is not directed at children. It collects no personal information from anyone, children included.",
    ],
  },
  {
    title: "Changes to this policy",
    blocks: [
      "If Teneo changes in a way that affects your privacy, this page changes with it, and the date at the top shows when.",
    ],
  },
];
</script>

<template>
  <header class="px-4 pt-6">
    <div class="mx-auto flex max-w-3xl items-center justify-between">
      <a href="/" class="flex items-center gap-2.5">
        <img src="/favicon.svg" alt="" class="size-8" />
        <span class="text-base font-semibold tracking-tight">Teneo</span>
      </a>
      <a
        href="/"
        class="text-foreground/70 hover:text-foreground text-sm font-medium transition-colors">
        Back to home
      </a>
    </div>
  </header>

  <main class="px-4 py-16 sm:py-24">
    <article class="mx-auto max-w-3xl">
      <h1
        class="text-4xl leading-[1.05] font-extrabold tracking-tight text-balance sm:text-5xl">
        Privacy Policy
      </h1>
      <p class="text-foreground/60 mt-4 text-sm">Last updated {{ UPDATED }}</p>

      <p class="mt-8 text-lg leading-relaxed text-pretty">
        Teneo keeps your clipboard history on your own devices. We don't collect
        it, we can't see it, and we don't run servers that receive it. This page
        covers Teneo for Mac, Teneo for Android and this website.
      </p>

      <section v-for="section in sections" :key="section.title" class="mt-12">
        <h2 class="text-2xl font-bold tracking-tight">{{ section.title }}</h2>
        <template v-for="(block, index) in section.blocks" :key="index">
          <p
            v-if="typeof block === 'string'"
            class="text-foreground/80 mt-4 leading-relaxed text-pretty">
            {{ block }}
          </p>
          <ul
            v-else
            class="text-foreground/80 mt-4 list-disc space-y-2.5 pl-5 leading-relaxed">
            <li v-for="item in block.list" :key="item">{{ item }}</li>
          </ul>
        </template>
      </section>

      <section class="mt-12">
        <h2 class="text-2xl font-bold tracking-tight">Contact</h2>
        <p class="text-foreground/80 mt-4 leading-relaxed text-pretty">
          Teneo is made by
          <a
            href="https://michaelnji.codes"
            target="_blank"
            rel="noopener noreferrer"
            class="decoration-foreground/30 hover:decoration-foreground underline underline-offset-4 transition-colors">
            c0d3v1l</a
          >. For a question about this policy or your privacy in Teneo,
          <a
            :href="ISSUES_URL"
            target="_blank"
            rel="noopener noreferrer"
            class="decoration-foreground/30 hover:decoration-foreground underline underline-offset-4 transition-colors">
            open an issue on GitHub</a
          >.
        </p>
      </section>
    </article>
  </main>

  <SiteFooter />
</template>
