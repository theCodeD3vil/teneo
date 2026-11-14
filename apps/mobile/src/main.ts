import "@fontsource-variable/figtree";
import { createApp } from "vue";

import App from "./App.vue";

import "./style.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () => {
  document.documentElement.classList.toggle("dark", colorScheme.matches);
};
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

createApp(App).mount("#app");
