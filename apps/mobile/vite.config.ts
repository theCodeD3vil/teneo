import { readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// The Android build's versionName is the app's one version number
const gradle = readFileSync(
  new URL("./android/app/build.gradle", import.meta.url),
  "utf8",
);
const appVersion = gradle.match(/versionName\s+"([^"]+)"/)?.[1] ?? "dev";

export default defineConfig({
  plugins: [vue(), tailwindcss(), Icons({ compiler: "vue3" })],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
});
