/** A version as the Android release workflow allows it: 1.2.3 or 1.2.3-beta.4 */
export interface AppVersion {
  major: number;
  minor: number;
  patch: number;
  /** null for a full release */
  beta: number | null;
}

// the same rule as release-android.yml: the last two numbers under 100 and
// the beta number under 99, since the version code is made from them
const pattern = /^(\d+)\.(\d{1,2})\.(\d{1,2})(?:-beta\.([1-9]\d?))?$/;

export function parseVersion(text: string): AppVersion | null {
  const match = pattern.exec(text);
  if (!match) return null;
  const beta = match[4] === undefined ? null : Number(match[4]);
  if (beta === 99) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    beta,
  };
}

/**
 * The version code android/app/build.gradle gives a version. Android only
 * updates to a larger one, so it is what "newer" means: 1.2.3-beta.4 is
 * 1020304, and 1.2.3 itself 1020399.
 */
export function versionCode(version: AppVersion): number {
  return (
    version.major * 1_000_000 +
    version.minor * 10_000 +
    version.patch * 100 +
    (version.beta ?? 99)
  );
}
