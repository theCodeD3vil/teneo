import { createApp } from "vue";

import "./style.css";
import PrivacyPage from "./PrivacyPage.vue";
import { initSentry } from "./sentry";

const app = createApp(PrivacyPage);
initSentry(app, "privacy");
app.mount("#app");
