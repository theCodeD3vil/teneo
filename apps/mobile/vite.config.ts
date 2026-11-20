import { readFileSync } from "node:fs";

import { sentryVitePlugin } from "@sentry/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// The app's one version number: Gradle reads the same one for the Android
// build's versionName, and a bump of it is what makes a release
const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

// Source maps are built and sent to Sentry only when a release build has
// SENTRY_AUTH_TOKEN, and deleted afterwards so they never ship
const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN);

export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: "vue3" }),
    sentryVitePlugin({
      org: "new-vision-creatives",
      project: "teneo-mobile",
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !uploadSourceMaps,
      release: { name: `teneo-mobile@${appVersion}` },
      sourcemaps: { filesToDeleteAfterUpload: ["./dist/**/*.map"] },
      telemetry: false,
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    sourcemap: uploadSourceMaps ? "hidden" : false,
    // sync.html is the page the sync service runs with no window
    rolldownOptions: { input: ["index.html", "sync.html"] },
  },
});
