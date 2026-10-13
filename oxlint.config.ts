import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
  },
  rules: {
    "eslint/no-unused-vars": "error",
    "no-alert": "error",
    "no-console": "error",
  },
  plugins: ["vue", "unicorn", "typescript", "oxc"],
  ignorePatterns: [
    "dist/**",
    "coverage/**",
    "vendor/**",
    "test/snapshots/**",
    "src/components/ui/**",
    ".build/**",
  ], //will update later
});
