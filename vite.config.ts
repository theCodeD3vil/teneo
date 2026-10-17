import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import { MagicRegExpTransformPlugin } from "magic-regexp/transform";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    Icons({ compiler: "vue3" }),
    MagicRegExpTransformPlugin.vite(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
});
