import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { disableBrowserBehaviorInProduction } from "./utils/browser-behavior";
import { syncThemeWithSystem } from "./utils/theme";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

const app = createApp(App);
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
