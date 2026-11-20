import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "../style.css";
import { initSentry } from "../lib/sentry";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import SettingsApp from "./SettingsApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

const app = createApp(SettingsApp);
initSentry(app, "settings");
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
