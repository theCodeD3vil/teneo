import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "../style.css";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import SettingsApp from "./SettingsApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

const app = createApp(SettingsApp);
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
