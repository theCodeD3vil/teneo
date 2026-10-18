import { createApp } from "vue";

import "../style.css";
import { syncThemeWithSystem } from "../utils/theme";
import SetupApp from "./SetupApp.vue";

syncThemeWithSystem();

createApp(SetupApp).mount("#app");
