import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { initSentry } from "./lib/sentry";
import { disableBrowserBehaviorInProduction } from "./utils/browser-behavior";
import { syncThemeWithSystem } from "./utils/theme";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

const app = createApp(App);
initSentry(app, "main");
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
