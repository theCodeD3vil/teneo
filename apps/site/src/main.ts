import { createApp } from "vue";

import "./style.css";
import App from "./App.vue";
import { initSentry } from "./sentry";

const app = createApp(App);
initSentry(app, "home");
app.mount("#app");
