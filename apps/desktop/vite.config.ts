import { readFileSync } from "node:fs";
import path from "node:path";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
// tinyjs.json holds the version the app is released as
const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./tinyjs.json", import.meta.url), "utf8"),
) as { version: string };

// Source maps are built and sent to Sentry only when a release build has
// SENTRY_AUTH_TOKEN, and deleted afterwards so they never ship
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

// https://vite.dev/config/
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: "vue3" }),
    sentryVitePlugin({
      org: "new-vision-creatives",
      project: "teneo-desktop",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !uploadSourceMaps,
      release: { name: `teneo-desktop@${appVersion}` },
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      telemetry: false,
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // each html file is its own window
  build: {
    sourcemap: uploadSourceMaps ? "hidden" : false,
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        settings: path.resolve(import.meta.dirname, "settings.html"),
        setup: path.resolve(import.meta.dirname, "setup.html"),
        update: path.resolve(import.meta.dirname, "update.html"),
      },
    },
  },
});
