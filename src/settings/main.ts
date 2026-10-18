import { createApp } from "vue";

import "../style.css";
import { syncThemeWithSystem } from "../utils/theme";
import SettingsApp from "./SettingsApp.vue";

syncThemeWithSystem();

createApp(SettingsApp).mount("#app");
