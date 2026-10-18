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
  // each html file is its own window
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, "index.html"),
        settings: path.resolve(import.meta.dirname, "settings.html"),
        setup: path.resolve(import.meta.dirname, "setup.html"),
      },
    },
  },
});
