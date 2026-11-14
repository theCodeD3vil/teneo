// Sync is not in full releases yet. It is on in a beta build, so testers can
// try it, and wherever TENEO_SYNC=1 asks for it.

/** Whether this version of Teneo, started with this environment, has sync. */
export function isSyncAvailableIn(
  env: { TENEO_SYNC?: string },
  version: string,
): boolean {
  return env.TENEO_SYNC === "1" || isBetaVersion(version);
}

/** A version with a beta suffix, such as 0.4.0-beta.1. */
export function isBetaVersion(version: string): boolean {
  return /^\d+\.\d+\.\d+-beta(\.|$)/.test(version);
}
