import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";

// The window is a transparent vibrancy panel, so the OS decides light/dark;
// mirror it onto shadcn's opt-in `.dark` class.
const prefersDark = matchMedia("(prefers-color-scheme: dark)");
const syncTheme = () =>
  document.documentElement.classList.toggle("dark", prefersDark.matches);
syncTheme();
prefersDark.addEventListener("change", syncTheme);

const app = createApp(App);
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
