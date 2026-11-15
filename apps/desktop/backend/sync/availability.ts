// Sync ships in every build of Teneo: full releases, betas and dev runs.
// TENEO_SYNC=0 switches it off for one run, to see the app without it.

/** Whether Teneo, started with this environment, has sync. */
export function isSyncAvailableIn(env: { TENEO_SYNC?: string }): boolean {
  return env.TENEO_SYNC !== "0";
}
