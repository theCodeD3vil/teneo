import type { CapacitorConfig } from "@capacitor/cli";

// Set by android:dev: the app loads the Vite dev server (through adb reverse)
// instead of the bundled build, so edits show up on the device right away
const liveReloadUrl = process.env.TENEO_LIVE_RELOAD_URL;

const config: CapacitorConfig = {
  appId: "com.michael.teneo",
  appName: "Teneo",
  webDir: "dist",
  ...(liveReloadUrl && {
    server: { url: liveReloadUrl, cleartext: true },
  }),
  plugins: {
    SystemBars: {
      insetsHandling: "css",
      initialViewportFitValueHint: "cover",
    },
  },
};

export default config;
