import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { syncThemeWithSystem } from "./utils/theme";

syncThemeWithSystem();

createApp(App).mount("#app");
