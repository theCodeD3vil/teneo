import { type Update, UpdateCheckError, findUpdate } from "./releases";
import type { InstallStatus, UpdatePlugin } from "./update-plugin";

export type UpdateState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "up_to_date" }
  | { kind: "available"; update: Update }
  /** Teneo may not install apps yet: Android's settings were opened */
  | { kind: "needs_permission"; update: Update }
  | { kind: "downloading"; update: Update; received: number }
  /** Handed to Android's installer, which asks the user */
  | { kind: "installing"; update: Update }
  /** A check or an install failed; with the update, it can be tried again */
  | { kind: "failed"; update: Update | null; message: string };

export interface UpdaterOptions {
  /** The installed version */
  current: () => Promise<string>;
  /** null in a browser, which can look for an update but not install one */
  plugin: UpdatePlugin | null;
  find?: (current: string) => Promise<Update | null>;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
}

const oneDayMs = 24 * 60 * 60 * 1000;
const lastCheckKey = "teneo.updates.lastCheck";
const dismissedKey = "teneo.updates.dismissed";
const askedToNotifyKey = "teneo.updates.askedToNotify";

/**
 * Looks for a newer Android release on GitHub and installs it: the app
 * downloads the APK and hands it to Android's installer.
 */
export class Updater {
  private readonly options: UpdaterOptions;
  private readonly find: (current: string) => Promise<Update | null>;
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  private readonly now: () => number;
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private current: UpdateState = { kind: "idle" };
  private checking: Promise<Update | null> | null = null;
  private readonly openedListeners = new Set<() => void>();
  /** Opened from the notification before anything listened */
  private wasOpened = false;
  /** Android said it is installing the update: the app is about to be replaced */
  private wasInstalled = false;

  constructor(options: UpdaterOptions) {
    this.options = options;
    const plugin = options.plugin;
    // in a browser there is no signed manifest to read: no update is offered
    this.find =
      options.find ??
      ((current) =>
        plugin ? findUpdate(current, plugin) : Promise.resolve(null));
    this.storage = options.storage ?? localStorage;
    this.now = options.now ?? Date.now;
    if (plugin) {
      void plugin.addListener("progress", ({ received }) => {
        if (this.current.kind === "downloading") {
          this.set({ ...this.current, received });
        }
      });
      void plugin.addListener("installStatus", (status) =>
        this.installStatus(status),
      );
      void plugin.addListener("openedFromNotification", () => {
        if (this.openedListeners.size === 0) this.wasOpened = true;
        for (const listener of this.openedListeners) listener();
      });
    }
  }

  get state(): UpdateState {
    return this.current;
  }

  onChange(listener: (state: UpdateState) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Told when the app is opened from the notification that says an update is
   * available, and at once if that happened before anything listened.
   */
  onOpenedFromNotification(listener: () => void): () => void {
    this.openedListeners.add(listener);
    if (this.wasOpened) {
      this.wasOpened = false;
      listener();
    }
    return () => {
      this.openedListeners.delete(listener);
    };
  }

  /**
   * Ask, once, to show the notification that says an update is available.
   * Android's own question; a no stays a no.
   */
  async askToNotify(): Promise<void> {
    if (!this.options.plugin || this.storage.getItem(askedToNotifyKey)) return;
    this.storage.setItem(askedToNotifyKey, "1");
    try {
      await this.options.plugin.requestNotifications();
    } catch {
      // the app still offers the update when it opens
    }
  }

  /** Look now, for "Check now". A check already under way is shared. */
  check(): Promise<Update | null> {
    if (this.checking) return this.checking;
    // mid-download or mid-install the update is already known
    if (this.isBusy()) return Promise.resolve(this.update());
    this.checking = this.runCheck().finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  /**
   * Look if a day has passed since the last look, for when the app opens.
   * The update to offer the user, or null: one they said "Later" to isn't
   * offered again, though Settings › About still shows it.
   */
  async checkIfDue(): Promise<Update | null> {
    const last = Number(this.storage.getItem(lastCheckKey));
    const now = this.now();
    // a clock set back would otherwise put the next look off for that long
    if (last > 0 && now - last < oneDayMs && now >= last) return null;
    const update = await this.check();
    if (!update || this.storage.getItem(dismissedKey) === update.version) {
      return null;
    }
    return update;
  }

  /** "Later": don't offer this version when the app opens */
  dismiss(update: Update): void {
    this.storage.setItem(dismissedKey, update.version);
  }

  /** Download and install the update found */
  async install(): Promise<void> {
    const update = this.update();
    if (!update || this.isBusy()) return;
    const plugin = this.options.plugin;
    if (!plugin) {
      this.set({
        kind: "failed",
        update,
        message: "Updates install in the Android app",
      });
      return;
    }
    try {
      if (!(await plugin.canInstall()).allowed) {
        this.set({ kind: "needs_permission", update });
        await plugin.openInstallSettings();
        return;
      }
      this.set({ kind: "downloading", update, received: 0 });
      await plugin.install({ version: update.version });
      // a status may already have come
      if (this.current.kind === "downloading") {
        this.set({ kind: "installing", update });
      }
    } catch (error) {
      if (codeOf(error) === "cancelled")
        this.set({ kind: "available", update });
      else this.set({ kind: "failed", update, message: messageOf(error) });
    }
  }

  /**
   * The app is back in front. From Android's settings: install, if Teneo may
   * now. From Android's installer: if it said nothing, it was left (Home,
   * Recents), which some phones don't report, so the update can be started
   * again; a new install replaces the old one (UpdatePlugin.commit).
   */
  async resumed(): Promise<void> {
    const state = this.current;
    if (state.kind === "needs_permission") {
      if ((await this.options.plugin?.canInstall())?.allowed) {
        // as tapped: available, then on to the download
        this.set({ kind: "available", update: state.update });
        await this.install();
      }
    } else if (state.kind === "installing" && !this.wasInstalled) {
      this.set({ kind: "available", update: state.update });
    }
  }

  async cancel(): Promise<void> {
    if (this.current.kind !== "downloading") return;
    await this.options.plugin?.cancel();
  }

  private async runCheck(): Promise<Update | null> {
    this.set({ kind: "checking" });
    try {
      const update = await this.find(await this.options.current());
      this.storage.setItem(lastCheckKey, String(this.now()));
      this.set(update ? { kind: "available", update } : { kind: "up_to_date" });
      return update;
    } catch (error) {
      this.set({
        kind: "failed",
        update: null,
        message:
          error instanceof UpdateCheckError
            ? error.message
            : "Couldn't check for updates",
      });
      return null;
    }
  }

  private installStatus(status: InstallStatus): void {
    const update = this.update();
    if (!update) return;
    if (status.status === "pending_user" || status.status === "installed") {
      if (status.status === "installed") this.wasInstalled = true;
      this.set({ kind: "installing", update });
    } else if (status.status === "cancelled") {
      this.set({ kind: "available", update });
    } else {
      this.set({ kind: "failed", update, message: status.message });
    }
  }

  private update(): Update | null {
    return "update" in this.current ? this.current.update : null;
  }

  /** Checking, downloading, or with Android's installer: starting another
   *  download then would make a second install of the same update */
  private isBusy(): boolean {
    return (
      this.current.kind === "checking" ||
      this.current.kind === "downloading" ||
      this.current.kind === "installing"
    );
  }

  private set(state: UpdateState): void {
    this.current = state;
    for (const listener of this.listeners) {
      try {
        listener(state);
      } catch {
        // one listener's trouble is not the others'
      }
    }
  }
}

/** Capacitor puts the code the plugin rejected with on the error */
function codeOf(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error
    ? error.code
    : undefined;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message || "The update couldn't be installed";
}

/** "9.9 MB" */
export function formatSize(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}
