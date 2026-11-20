import { createApp } from "vue";

import "../style.css";
import { initSentry } from "../lib/sentry";
import { disableBrowserBehaviorInProduction } from "../utils/browser-behavior";
import { syncThemeWithSystem } from "../utils/theme";
import UpdateApp from "./UpdateApp.vue";

syncThemeWithSystem();
disableBrowserBehaviorInProduction();
const app = createApp(UpdateApp);
initSentry(app, "update");
app.mount("#app");
