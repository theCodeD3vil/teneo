import { devSuffix, isDevRunEnv, isRealDataInDevRunEnv } from "./dev-data";

// `bun test` has no tjs, and nothing there is a dev run
const env = () => (typeof tjs === "undefined" ? {} : tjs.env);

export function isDevRun(): boolean {
  return isDevRunEnv(env());
}

/** The name to give app.store keys and Keychain entries: a dev run gets its
 *  own, so it never reads or overwrites the installed app's. */
export function devName(name: string): string {
  return isDevRun() ? `${name}${devSuffix}` : name;
}

/** A dev run on the real data must never be silent. */
export function warnIfDevRunUsesRealData(): void {
  if (!isRealDataInDevRunEnv(env())) return;
  // oxlint-disable-next-line no-console -- the backend's startup notice
  console.warn(
    "TENEO_REAL_DATA=1: this dev run is using the REAL history, settings and Keychain key",
  );
}
