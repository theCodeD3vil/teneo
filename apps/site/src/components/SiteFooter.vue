<script setup lang="ts">
const linkClass =
  "underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground";
</script>

<template>
  <footer class="px-4 py-8">
    <div
      class="text-foreground/70 mx-auto flex max-w-7xl flex-col items-center gap-3 text-sm sm:flex-row sm:justify-between">
      <p>
        Built with ❤️ and tiny.js by
        <a
          href="https://michaelnji.codes"
          target="_blank"
          rel="noopener noreferrer"
          :class="linkClass">
          c0d3v1l
        </a>
      </p>
      <p>
        Photo by
        <a
          href="https://unsplash.com/@enginakyurt?utm_source=unsplash&amp;utm_medium=referral&amp;utm_content=creditCopyText"
          target="_blank"
          rel="noopener noreferrer"
          :class="linkClass">
          engin akyurt
        </a>
        on
        <a
          href="https://unsplash.com/photos/white-clouds-and-blue-sky-during-daytime-zlGobrmAuyE?utm_source=unsplash&amp;utm_medium=referral&amp;utm_content=creditCopyText"
          target="_blank"
          rel="noopener noreferrer"
          :class="linkClass">
          Unsplash
        </a>
      </p>
    </div>
  </footer>
</template>
