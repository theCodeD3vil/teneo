import "@fontsource-variable/figtree";
import { createApp } from "vue";

import App from "./App.vue";
import { provideClient } from "./client";
import { FakeClient } from "./client/fake-client";

import "./style.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () => {
  document.documentElement.classList.toggle("dark", colorScheme.matches);
};
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

const app = createApp(App);
const fakeClient = new FakeClient();
provideClient(app, fakeClient);
app.mount("#app");
