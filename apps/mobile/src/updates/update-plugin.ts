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
   * Download the APK, check its size, digest, package and version, and hand
   * it to Android's installer. Resolves once the installer has it; what
   * happens next comes as `installStatus`. Rejects with what to show.
   */
  install(options: {
    url: string;
    size: number;
    sha256: string | null;
    versionCode: number;
  }): Promise<void>;
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
