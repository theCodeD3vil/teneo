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
  /** null in a browser: an update is only ever a download link there */
  plugin: UpdatePlugin | null;
  find?: (current: string) => Promise<Update | null>;
  storage?: Pick<Storage, "getItem" | "setItem">;
  now?: () => number;
  /** Open a link in the phone's browser */
  openUrl?: (url: string) => void;
}

const oneDayMs = 24 * 60 * 60 * 1000;
const lastCheckKey = "teneo.updates.lastCheck";
const dismissedKey = "teneo.updates.dismissed";

/**
 * Looks for a newer Android release on GitHub and installs it: the app
 * downloads the APK and hands it to Android's installer, or, failing that,
 * the phone's browser downloads it from the same link.
 */
export class Updater {
  private readonly options: UpdaterOptions;
  private readonly find: (current: string) => Promise<Update | null>;
  private readonly storage: Pick<Storage, "getItem" | "setItem">;
  private readonly now: () => number;
  private readonly openUrl: (url: string) => void;
  private readonly listeners = new Set<(state: UpdateState) => void>();
  private current: UpdateState = { kind: "idle" };
  private checking: Promise<Update | null> | null = null;

  constructor(options: UpdaterOptions) {
    this.options = options;
    this.find = options.find ?? ((current) => findUpdate(current));
    this.storage = options.storage ?? localStorage;
    this.now = options.now ?? Date.now;
    this.openUrl =
      options.openUrl ?? ((url) => void window.open(url, "_blank"));
    const plugin = options.plugin;
    if (plugin) {
      void plugin.addListener("progress", ({ received }) => {
        if (this.current.kind === "downloading") {
          this.set({ ...this.current, received });
        }
      });
      void plugin.addListener("installStatus", (status) =>
        this.installStatus(status),
      );
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

  /** Download and install the update found, or open its link without native code */
  async install(): Promise<void> {
    const update = this.update();
    if (!update || this.isBusy()) return;
    const plugin = this.options.plugin;
    if (!plugin) {
      this.openInBrowser();
      return;
    }
    try {
      if (!(await plugin.canInstall()).allowed) {
        this.set({ kind: "needs_permission", update });
        await plugin.openInstallSettings();
        return;
      }
      this.set({ kind: "downloading", update, received: 0 });
      await plugin.install({
        url: update.apkUrl,
        size: update.size,
        sha256: update.sha256,
        versionCode: update.versionCode,
      });
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

  async cancel(): Promise<void> {
    if (this.current.kind !== "downloading") return;
    await this.options.plugin?.cancel();
  }

  /** The browser downloads the APK; Android's installer opens it from there */
  openInBrowser(): void {
    const update = this.update();
    if (update) this.openUrl(update.apkUrl);
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
