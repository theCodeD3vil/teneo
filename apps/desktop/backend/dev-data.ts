// What a dev run (`tinyjs dev`) keeps apart from the installed app's data. No
// globals in here, so the reset script and the tests can import it.

/** Added to the name of every store key and Keychain entry in a dev run. */
export const devSuffix = "-dev";

/** Every `app.store` key and Keychain entry Teneo writes, by its normal name.
 *  `bun run desktop:reset-dev-data` removes the dev copies of these, so a new
 *  one goes here as well as through `devName()`. */
export const appStoreKeys = [
  "settings",
  "setupComplete",
  "syncDeviceId",
  "localAiEnabled",
];
export const appSecretNames = ["history-encryption-key"];

type Env = Record<string, string | undefined>;

/** `tinyjs dev` is the only run that sets TINYJS_ICON. TENEO_REAL_DATA=1 opts
 *  back in to the installed app's real data. */
export function isDevRunEnv(env: Env): boolean {
  return Boolean(env.TINYJS_ICON) && env.TENEO_REAL_DATA !== "1";
}

export function isRealDataInDevRunEnv(env: Env): boolean {
  return Boolean(env.TINYJS_ICON) && env.TENEO_REAL_DATA === "1";
}

/** The dev run's own folder inside one of the app's folders. */
export function devFolder(folder: string): string {
  return `${folder.replace(/\/$/, "")}/dev`;
}
