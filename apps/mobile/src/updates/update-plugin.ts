import type { PluginListenerHandle } from "@capacitor/core";

/** What Android's installer said about an update handed to it */
export type InstallStatus =
  /** Android shows its confirmation: the user decides there */
  | { status: "pending_user" }
  | { status: "installed" }
  /** The user said no */
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** UpdatePlugin.java in the Android app */
export interface UpdatePlugin {
  /** Whether the user lets Teneo install apps ("Install unknown apps") */
  canInstall(): Promise<{ allowed: boolean }>;
  /** Open Teneo's "Install unknown apps" page in Android's settings */
  openInstallSettings(): Promise<void>;
  /**
   * The newest release of this app, if newer than this one, from the signed
   * manifest in Teneo's update channel once its signature checks out
   * (SignedManifest.java). `update` is null when there is none. Rejects with
   * what to show.
   */
  check(): Promise<{
    update: {
      version: string;
      versionCode: number;
      apkUrl: string;
      size: number;
      sha256: string;
    } | null;
  }>;
  /**
   * Install `version`, which check() offered: read the signed manifest again
   * (it must still offer that version), download the APK it names, check its
   * size, hash, package and version, and hand it to Android's installer.
   * Resolves once the installer has it; what happens next comes as
   * `installStatus`. Rejects with what to show.
   */
  install(options: { version: string }): Promise<void>;
  /** Stop a download; `install` rejects with the code "cancelled" */
  cancel(): Promise<void>;
  /**
   * Ask Android to let Teneo show notifications, for the one that says an
   * update is available. Android asks the user only the first time or two.
   */
  requestNotifications(): Promise<{ granted: boolean }>;
  addListener(
    event: "progress",
    listener: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
  addListener(
    event: "installStatus",
    listener: (status: InstallStatus) => void,
  ): Promise<PluginListenerHandle>;
  /** The app was opened from the notification that says an update is available */
  addListener(
    event: "openedFromNotification",
    listener: () => void,
  ): Promise<PluginListenerHandle>;
}
