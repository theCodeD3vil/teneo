import { Capacitor } from "@capacitor/core";
import { createApp } from "vue";

import App from "./App.vue";
import { provideClient } from "./client";
import { FakeClient } from "./client/fake-client";
import { NativeClient } from "./client/native-client";
import { History } from "./client/native-history";
import { NativeSync } from "./client/native-sync";
import { Sync } from "./client/native-sync-plugin";
import { initNavigation } from "./composables/useNavigation";
import { isSetupDone } from "./composables/useSetup";
import { provideUpdater } from "./composables/useUpdates";
import { Updates } from "./updates/native-update-plugin";
import { Updater } from "./updates/updater";

import "./style.css";

const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const applyColorScheme = () => {
  document.documentElement.classList.toggle("dark", colorScheme.matches);
};
applyColorScheme();
colorScheme.addEventListener("change", applyColorScheme);

initNavigation(isSetupDone() ? "history" : "setup");

const app = createApp(App);
// the phone keeps its own history and syncs it; a browser shows sample items
provideClient(
  app,
  Capacitor.isNativePlatform() ? nativeClient() : new FakeClient(),
);

function nativeClient(): NativeClient {
  // a debug build can be paired from adb (DebugSyncReceiver.java), the way a
  // typed code pairs
  const sync = new NativeSync(Sync, {
    onDebugPair: (code) =>
      void client.pair(code).then((result) => {
        // oxlint-disable-next-line no-console -- read over adb logcat
        console.info(`debug pairing: ${result.ok ? "paired" : result.error}`);
      }),
  });
  const client = new NativeClient(History, { sync });
  return client;
}

// in a browser an update can only be a download link
provideUpdater(
  new Updater({
    current: async () => __APP_VERSION__,
    plugin: Capacitor.isNativePlatform() ? Updates : null,
  }),
);
app.mount("#app");
