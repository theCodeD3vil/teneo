import { createApp } from "vue";

import "../style.css";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import UpdateApp from "./UpdateApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();
createApp(UpdateApp).mount("#app");
