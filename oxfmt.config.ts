import { defineConfig } from "oxfmt";

export default defineConfig({
  printWidth: 80,
  sortImports: true,
  sortTailwindcss: true,
  bracketSameLine: true,
  ignorePatterns: [
    "src/components/ui/**",
    ".build/**",
    "site/src/components/ui/**",
    "site/dist/**",
  ],
});
