import { createApp } from "vue";

import "../style.css";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import SetupApp from "./SetupApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

createApp(SetupApp).mount("#app");
