// Teneo is built as three apps, so a beta and a dev run install and run
// beside the full release: each has its own name, and its own id, which is
// what macOS keys its data folder, Keychain entries and permissions by. No
// globals in here, so the scripts and the tests can import it.
export type AppVariant = "production" | "beta" | "debug";

interface AppIdentity {
  title: string;
  id: string;
  /** Where the app looks for its updates */
  updateUrl: string;
}

const releases = "https://github.com/theCodeD3vil/teneo/releases";

/** The GitHub release that only holds the newest beta's manifest.json
 *  (release.yml replaces it on every beta). A beta can't update from
 *  releases/latest: that is a full release, another app. */
export const betaChannelTag = "beta-channel";

const productionUpdateUrl = `${releases}/latest/download/manifest.json`;

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
  },
  // a dev run never updates itself
  debug: {
    title: "Teneo Debug",
    id: "com.michael.teneo.debug",
    updateUrl: productionUpdateUrl,
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

export interface TinyConfig {
  title?: string;
  id?: string;
  update?: { url?: string };
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
  return {
    ...config,
    title: identity.title,
    id: options.keepId ? config.id : identity.id,
    update: { ...config.update, url: identity.updateUrl },
  };
}
