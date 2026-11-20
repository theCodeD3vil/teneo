import { parseVersion, versionCode } from "./versions";

/** Where the Android app is released */
export const repository = "theCodeD3vil/teneo";

/** A newer release this phone can install, as its signed manifest says */
export interface Update {
  version: string;
  versionCode: number;
  /** The APK on GitHub, in Teneo's release */
  apkUrl: string;
  /** In bytes */
  size: number;
  /** Hex: the APK's SHA-256, from the signed manifest */
  sha256: string;
}

export class UpdateCheckError extends Error {}

/** UpdatePlugin.check, as findUpdate uses it */
export interface UpdateSource {
  check(): Promise<{ update: unknown }>;
}

/**
 * The newest release newer than `current`, or null when there is none. The
 * app reads it from the signed manifest in Teneo's update channel
 * (UpdatePlugin.check, SignedManifest.java), where release:publish puts it:
 * one small download, checked against Teneo's update key before anything is
 * believed. A beta install is offered only betas and a full release only
 * full releases: Teneo Beta and Teneo are two apps (android/app/build.gradle),
 * and each has its own manifest in the channel.
 */
export async function findUpdate(
  current: string,
  source: UpdateSource,
): Promise<Update | null> {
  const installed = parseVersion(current);
  if (!installed) {
    throw new UpdateCheckError("This build has no release version to compare");
  }
  let answer: { update: unknown };
  try {
    answer = await source.check();
  } catch (error) {
    throw new UpdateCheckError(
      error instanceof Error && error.message
        ? error.message
        : "Couldn't check for updates",
    );
  }
  const update = parseUpdate(answer?.update);
  if (!update) return null;
  const offered = parseVersion(update.version)!;
  // native code checked these; a page that is told otherwise offers nothing
  if (
    (offered.beta === null) !== (installed.beta === null) ||
    update.versionCode !== versionCode(offered) ||
    update.versionCode <= versionCode(installed)
  ) {
    return null;
  }
  return update;
}

/** A well-formed update, or null */
function parseUpdate(value: unknown): Update | null {
  if (typeof value !== "object" || value === null) return null;
  const update = value as Record<string, unknown>;
  if (
    typeof update.version !== "string" ||
    !parseVersion(update.version) ||
    typeof update.versionCode !== "number" ||
    typeof update.apkUrl !== "string" ||
    !update.apkUrl.startsWith(
      `https://github.com/${repository}/releases/download/`,
    ) ||
    typeof update.size !== "number" ||
    !(update.size > 0) ||
    typeof update.sha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(update.sha256)
  ) {
    return null;
  }
  return {
    version: update.version,
    versionCode: update.versionCode,
    apkUrl: update.apkUrl,
    size: update.size,
    sha256: update.sha256,
  };
}
