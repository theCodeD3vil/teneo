import path from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// Source maps are built and sent to Sentry only when a release build has
// SENTRY_AUTH_TOKEN, and deleted afterwards so they never ship
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: "vue3" }),
    sentryVitePlugin({
      org: "new-vision-creatives",
      project: "teneo-site",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !uploadSourceMaps,
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      telemetry: false,
    }),
  ],
  build: {
    sourcemap: uploadSourceMaps ? "hidden" : false,
    // privacy.html is the privacy policy, a page of its own so it has an
    // address to give Google Play
    rolldownOptions: { input: ["index.html", "privacy.html"] },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
