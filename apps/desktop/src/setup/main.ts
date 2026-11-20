import { createApp } from "vue";

import "../style.css";
import { initSentry } from "../lib/sentry";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import SetupApp from "./SetupApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();

const app = createApp(SetupApp);
initSentry(app, "setup");
app.mount("#app");
