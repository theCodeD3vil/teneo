// tinyjs reads the app's name and id from tinyjs.json and nowhere else, so a
// build or a dev run of another of Teneo's three apps (backend/app-identity.ts)
// rewrites the file first.
import { readFileSync, writeFileSync } from "node:fs";

import {
  type AppVariant,
  type TinyConfig,
  withIdentity,
} from "../backend/app-identity.ts";

const path = "tinyjs.json";

export function readAppConfig(): TinyConfig & { version: string } {
  return JSON.parse(readFileSync(path, "utf8")) as TinyConfig & {
    version: string;
  };
}

/** Make tinyjs.json this app's, keeping everything else in it. */
export function writeAppIdentity(
  variant: AppVariant,
  options: { keepId?: boolean } = {},
): void {
  const config = withIdentity(readAppConfig(), variant, options);
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
}
