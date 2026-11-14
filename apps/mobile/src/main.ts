import "@fontsource-variable/figtree";
import { createApp } from "vue";

import App from "./App.vue";
import { provideClient } from "./client";
import { FakeClient } from "./client/fake-client";
import { initNavigation } from "./composables/useNavigation";
import { isSetupDone } from "./composables/useSetup";

import "./style.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () => {
  document.documentElement.classList.toggle("dark", colorScheme.matches);
};
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

initNavigation(isSetupDone() ? "history" : "setup");

const app = createApp(App);
provideClient(app, new FakeClient());
app.mount("#app");
