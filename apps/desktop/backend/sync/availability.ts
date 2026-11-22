// Sync ships in every build of Teneo: full releases, betas and dev runs.
// TENEO_SYNC=0 switches it off for one run, to see the app without it.

import { isBetaVersion } from "../app-identity";

/** Whether Teneo, started with this environment, has sync. */
export function isSyncAvailableIn(env: { TENEO_SYNC?: string }): boolean {
  return env.TENEO_SYNC !== "0";
}

/** Beta testers can choose Trusted Sync without launching from a terminal.
 *  This only offers the setup action; existing vaults never auto-migrate. */
export function isTrustedSyncOfferedIn(
  env: { TENEO_TRUSTED_SYNC?: string; TINYJS_ICON?: string },
  version: string,
): boolean {
  return (
    env.TENEO_TRUSTED_SYNC === "1" ||
    (!env.TINYJS_ICON &&
      env.TENEO_TRUSTED_SYNC !== "0" &&
      isBetaVersion(version))
  );
}
