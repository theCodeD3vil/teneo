import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import vue from "@vitejs/plugin-vue";
import Icons from "unplugin-icons/vite";
import { defineConfig } from "vite";
// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), Icons({ compiler: "vue3" })],
  // absolute repo path, so mock clipboard files point at real files on any machine
  define: { __PROJECT_ROOT__: JSON.stringify(__dirname) },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
