import { parseVersion, versionCode } from "./versions";

/** Where the Android app is released (release-android.yml) */
export const repository = "theCodeD3vil/teneo";
const tagPrefix = "android-v";
const api = `https://api.github.com/repos/${repository}`;

/** A newer release this phone can install */
export interface Update {
  version: string;
  versionCode: number;
  /** The APK on GitHub: the browser can download it too */
  apkUrl: string;
  /** In bytes */
  size: number;
  /** Hex, from GitHub's digest of the asset; null when GitHub has none */
  sha256: string | null;
}

export interface FindOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
}

interface Ref {
  ref?: unknown;
}

interface ReleaseAsset {
  name?: unknown;
  size?: unknown;
  digest?: unknown;
  browser_download_url?: unknown;
}

interface Release {
  draft?: unknown;
  assets?: unknown;
}

export class UpdateCheckError extends Error {}

/** 600 tags: far more Android releases than there will be for years */
const maxTagPages = 20;

/** The address of the next page from GitHub's Link header, if there is one,
 *  and only when it is GitHub's own API */
function nextPage(link: string | null): string | null {
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(link ?? "");
  return match?.[1]?.startsWith(`${api}/`) ? match[1] : null;
}

/**
 * The newest Android release newer than `current`, or null when there is
 * none. A beta install is offered only betas and a full release only full
 * releases: Teneo Beta and Teneo are two apps (android/app/build.gradle), and
 * Android won't update one with the other. It lists the android-v tags, then reads the release of
 * the newest: two small requests, where listing the releases would download
 * every Mac release's notes too.
 */
export async function findUpdate(
  current: string,
  options: FindOptions = {},
): Promise<Update | null> {
  const installed = parseVersion(current);
  if (!installed) {
    throw new UpdateCheckError("This build has no release version to compare");
  }
  const get = (path: string) => request(`${api}${path}`, options);

  // GitHub hands the tags over a page at a time, in name order, so the newest
  // need not be on the first: follow the pages (a few; each holds 30 tags)
  const list: Ref[] = [];
  let next: string | null = `${api}/git/matching-refs/tags/${tagPrefix}`;
  for (let page = 0; next && page < maxTagPages; page++) {
    const refs: Response = await request(next, options);
    if (!refs.ok) throw failure(refs);
    const entries = (await refs.json()) as unknown;
    if (Array.isArray(entries)) list.push(...(entries as Ref[]));
    next = nextPage(refs.headers.get("link"));
  }
  const candidates = list
    .map((entry) => {
      const ref = typeof entry.ref === "string" ? entry.ref : "";
      const text = ref.startsWith(`refs/tags/${tagPrefix}`)
        ? ref.slice(`refs/tags/${tagPrefix}`.length)
        : "";
      const version = parseVersion(text);
      return version && { text, code: versionCode(version), version };
    })
    .filter((entry) => entry !== null)
    .filter(
      (entry) => (entry.version.beta === null) === (installed.beta === null),
    )
    .filter((entry) => entry.code > versionCode(installed))
    .sort((a, b) => b.code - a.code);

  // a tag whose release failed or is still a draft is passed over, a few times
  for (const candidate of candidates.slice(0, 3)) {
    const response = await get(
      `/releases/tags/${tagPrefix}${encodeURIComponent(candidate.text)}`,
    );
    if (response.status === 404) continue;
    if (!response.ok) throw failure(response);
    const release = (await response.json()) as Release;
    if (release.draft === true) continue;
    const apk = findApk(release, candidate.text);
    if (apk)
      return { version: candidate.text, versionCode: candidate.code, ...apk };
  }
  return null;
}

function findApk(
  release: Release,
  version: string,
): Pick<Update, "apkUrl" | "size" | "sha256"> | null {
  const assets = Array.isArray(release.assets)
    ? (release.assets as ReleaseAsset[])
    : [];
  const prefix = `https://github.com/${repository}/releases/download/${tagPrefix}${version}/`;
  for (const asset of assets) {
    const name = typeof asset.name === "string" ? asset.name : "";
    const url =
      typeof asset.browser_download_url === "string"
        ? asset.browser_download_url
        : "";
    const size = typeof asset.size === "number" ? asset.size : 0;
    if (!name.endsWith(".apk") || !url.startsWith(prefix) || size <= 0) {
      continue;
    }
    const digest =
      typeof asset.digest === "string"
        ? /^sha256:([0-9a-f]{64})$/i.exec(asset.digest)?.[1]
        : undefined;
    return { apkUrl: url, size, sha256: digest?.toLowerCase() ?? null };
  }
  return null;
}

async function request(url: string, options: FindOptions): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );
  try {
    return await (options.fetch ?? fetch)(url, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    });
  } catch {
    throw new UpdateCheckError("Couldn't reach GitHub");
  } finally {
    clearTimeout(timer);
  }
}

function failure(response: Response): UpdateCheckError {
  // unauthenticated requests share 60 an hour per address
  if (response.status === 403 || response.status === 429) {
    return new UpdateCheckError("GitHub is busy. Try again later");
  }
  return new UpdateCheckError(`GitHub answered ${response.status}`);
}
