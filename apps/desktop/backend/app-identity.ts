// Teneo is built as three apps, so a beta and a dev run install and run
// beside the full release: each has its own name, and its own id, which is
// what macOS keys its data folder, Keychain entries and permissions by. Each
// has its own icon too, so they are told apart in Finder, the Dock and menu bar. No
// globals in here, so the scripts and the tests can import it.
export type AppVariant = "production" | "beta" | "debug";

interface AppIdentity {
  title: string;
  id: string;
  /** Where the app looks for its updates */
  updateUrl: string;
  /** The app's icon, beside tinyjs.json. The full release has none named:
   *  tinyjs takes icon.png. The beta's has a beaker on the front sheet, in
   *  green; the dev run's a wrench, in orange (icon-beta.svg, icon-debug.svg). */
  icon?: string;
}

const releases = "https://github.com/theCodeD3vil/teneo/releases";

/** The GitHub release that only holds the newest beta's manifest.json
 *  (release.yml replaces it on every beta). A beta can't update from
 *  releases/latest: that is a full release, another app. */
export const betaChannelTag = "beta-channel";

const productionUpdateUrl = `${releases}/latest/download/manifest.json`;

const menuBarIcons: Record<AppVariant, string> = {
  production: "tray.png",
  beta: "tray-beta.png",
  debug: "tray-debug.png",
};

export const appIdentities: Record<AppVariant, AppIdentity> = {
  production: {
    title: "Teneo",
    id: "com.michael.teneo",
    updateUrl: productionUpdateUrl,
  },
  beta: {
    title: "Teneo Beta",
    id: "com.michael.teneo.beta",
    updateUrl: `${releases}/download/${betaChannelTag}/manifest.json`,
    icon: "icon-beta.png",
  },
  // a dev run never updates itself
  debug: {
    title: "Teneo Debug",
    id: "com.michael.teneo.debug",
    updateUrl: productionUpdateUrl,
    icon: "icon-debug.png",
  },
};

/** A version with a beta suffix, such as 0.4.0-beta.1. */
export function isBetaVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-beta(\.|$)/.test(version);
}

/** The app a release of this version is: a beta version is Teneo Beta. */
export function releaseVariant(version: string): "production" | "beta" {
  return isBetaVersion(version) ? "beta" : "production";
}

/** A debug run keeps its debug icon even when using another build's data. */
export function menuBarIcon(appId: string, dev: boolean): string {
  if (dev || appId === appIdentities.debug.id) return menuBarIcons.debug;
  return appId === appIdentities.beta.id
    ? menuBarIcons.beta
    : menuBarIcons.production;
}

export interface TinyConfig {
  title?: string;
  id?: string;
  icon?: string;
  update?: { url?: string; publicKey?: string | string[] };
  [key: string]: unknown;
}

/** tinyjs.json as one of the three apps. `keepId` changes the name only, for a
 *  dev run on the installed app's data (TENEO_REAL_DATA=1). */
export function withIdentity<Config extends TinyConfig>(
  config: Config,
  variant: AppVariant,
  options: { keepId?: boolean } = {},
): Config {
  const identity = appIdentities[variant];
  // the full release names no icon, so the key goes rather than stay empty
  const { icon: _icon, ...rest } = config;
  return {
    ...rest,
    title: identity.title,
    id: options.keepId ? config.id : identity.id,
    ...(identity.icon && { icon: identity.icon }),
    update: { ...config.update, url: identity.updateUrl },
  } as Config;
}
