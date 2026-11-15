import { readFileSync } from "node:fs";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";

// The app's one version number, which build.gradle makes the Android
// build's versionName too
const appVersion =
  (
    JSON.parse(
      readFileSync(new URL("./package.json", import.meta.url), "utf8"),
    ) as { version?: string }
  ).version ?? "dev";

export default defineConfig({
  plugins: [vue(), tailwindcss(), Icons({ compiler: "vue3" })],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  build: {
    // sync.html is the page the sync service runs with no window
    rolldownOptions: { input: ["index.html", "sync.html"] },
  },
});
