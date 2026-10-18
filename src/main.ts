import { QueryClient, VueQueryPlugin } from "@tanstack/vue-query";
import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { syncThemeWithSystem } from "./utils/theme";

syncThemeWithSystem();

const app = createApp(App);
app.use(VueQueryPlugin, { queryClient: new QueryClient() });
app.mount("#app");
