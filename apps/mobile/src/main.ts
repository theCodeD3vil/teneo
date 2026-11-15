import { Capacitor } from "@capacitor/core";
import { createApp } from "vue";

import App from "./App.vue";
import { provideClient } from "./client";
import { FakeClient } from "./client/fake-client";
import { NativeClient } from "./client/native-client";
import { History } from "./client/native-history";
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
// the phone keeps its own history; a browser shows sample items
provideClient(
  app,
  Capacitor.isNativePlatform() ? new NativeClient(History) : new FakeClient(),
);
app.mount("#app");
