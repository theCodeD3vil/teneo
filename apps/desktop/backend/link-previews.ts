// Previews for copied links: the site's icon, or the page's own image when the
// site has none. Teneo asks the site itself, never a favicon service, so no
// one else learns which links were copied.
//
// Opening a link can do something: sign-in, password-reset and unsubscribe
// links work once. So the copied page is opened only for the image fallback
// and only when the link doesn't look like one of those; icons come from the
// site's home page. A link that looks like one of those, or carries a key,
// gets no preview at all: it may be a tracker made for this one copy, and
// asking its site even for an icon would tell it the link was seen. Links to
// this Mac or its local network are never fetched.
import { findLink } from "@teneo/shared/detection/links";
import { findIcons, findPageImageUrl } from "@teneo/shared/links/page-tags";
import type { LinkPreviewImage } from "@teneo/shared/types/clipboard";

import { logError, pngDataUrl } from "./files";
import { canOpenPage, isLocalAddress, publicAddressOf } from "./link-safety";
import { appPaths } from "./paths";
import { type PinnedResponse, pinnedGet } from "./pinned-fetch";
import { getSettings } from "./settings";
import { generateUUID } from "./utils/uuid-generator";

const PREVIEW_SIZE = 64;
/** the item preview's 288 px picture; app.thumbnail renders @2x for Retina */
const LARGE_PREVIEW_SIZE = 300;
/** a preview, or the note that a site has none, is fetched again after this */
const CACHE_LIFETIME = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT = 8000;
/** icon and image links sit in the <head>, near the top of the page */
const MAX_HTML_BYTES = 256 * 1024;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_REDIRECTS = 5;
/** a list full of new links shouldn't open dozens of connections at once */
const MAX_FETCHES = 4;
// Some sites turn away requests that don't look like a browser
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 Teneo";

/** A link's preview as a data: URL, or null when previews are off or the site
 *  has nothing to show. Rejects when the site can't be reached, so the page
 *  tries again later instead of remembering that there's no preview. */
export async function getLinkPreview(
  url: unknown,
  app: TinyApp,
): Promise<string | null> {
  if (!getSettings().showLinkPreviews || typeof url !== "string") return null;
  const link = findLink(url);
  if (!link) return null;
  const page = new URL(link.url);
  if (isLocalAddress(page) || !canOpenPage(page)) return null;

  const siteIcon = await cached(`site-${await hash(page.origin)}`, app, () =>
    findSiteIcon(page.origin, app),
  );
  if (siteIcon) return siteIcon;
  return cached(`page-${await hash(page.href)}`, app, () =>
    findPageImage(page.href, app),
  );
}

/** The picture for a link's item preview, the most specific first: the
 *  copied page's own image when it's safe to open, the home page's image,
 *  then the site's icon. Null when previews are off or there's none. */
export async function getLinkPreviewImage(
  url: unknown,
  app: TinyApp,
): Promise<LinkPreviewImage | null> {
  if (!getSettings().showLinkPreviews || typeof url !== "string") return null;
  const link = findLink(url);
  if (!link) return null;
  const page = new URL(link.url);
  if (isLocalAddress(page) || !canOpenPage(page)) return null;

  const isHomePage = page.href === new URL(page.origin).href;
  if (!isHomePage) {
    const image = await cached(`page-large-${await hash(page.href)}`, app, () =>
      findPageImage(page.href, app, LARGE_PREVIEW_SIZE),
    );
    if (image) return { image, source: "page" };
  }
  const homeImage = await cached(
    `home-large-${await hash(page.origin)}`,
    app,
    () => findPageImage(page.origin, app, LARGE_PREVIEW_SIZE),
  );
  if (homeImage) return { image: homeImage, source: "home" };

  // the card's icon, so it's usually saved already
  const icon = await cached(`site-${await hash(page.origin)}`, app, () =>
    findSiteIcon(page.origin, app),
  );
  return icon ? { image: icon, source: "icon" } : null;
}

/** Delete every saved preview, e.g. when history is cleared. */
export async function clearLinkPreviews(app: TinyApp): Promise<void> {
  await tjs
    .remove(await cacheFolder(app))
    .catch((error: unknown) =>
      logError("clearing link previews failed:", error),
    );
}

/** Delete previews older than CACHE_LIFETIME. They'd be fetched again anyway,
 *  and this keeps icons of links long gone from history off the disk. */
export async function removeStaleLinkPreviews(app: TinyApp): Promise<void> {
  const folder = await cacheFolder(app);
  const entries = await tjs.readDir(folder).catch(() => null);
  if (!entries) return;
  for await (const entry of entries) {
    const path = `${folder}/${entry.name}`;
    if (!(await isFresh(path))) await tjs.remove(path).catch(() => undefined);
  }
}

async function cacheFolder(app: TinyApp): Promise<string> {
  const { cache } = await appPaths(app);
  return `${cache.replace(/\/$/, "")}/link-previews`;
}

async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return new Uint8Array(digest).toHex();
}

async function isFresh(path: string): Promise<boolean> {
  const stats = await tjs.stat(path).catch(() => null);
  return stats !== null && Date.now() - stats.mtim.getTime() < CACHE_LIFETIME;
}

// Two cards with links to the same site wait on one fetch
const fetchesInProgress = new Map<string, Promise<string | null>>();

/** The saved preview `key`, made with `makePng` when there's none yet. A site
 *  without a preview is saved as an empty `.none` file, so it isn't asked again. */
function cached(
  key: string,
  app: TinyApp,
  makePng: () => Promise<Uint8Array | null>,
): Promise<string | null> {
  const inProgress = fetchesInProgress.get(key);
  if (inProgress) return inProgress;

  const preview = (async () => {
    const folder = await cacheFolder(app);
    const pngPath = `${folder}/${key}.png`;
    const nonePath = `${folder}/${key}.none`;
    if (await isFresh(pngPath)) return pngDataUrl(pngPath);
    if (await isFresh(nonePath)) return null;

    const png = await limitFetches(makePng);
    await tjs.makeDir(folder, { recursive: true });
    await tjs.writeFile(png ? pngPath : nonePath, png ?? new Uint8Array());
    await tjs.remove(png ? nonePath : pngPath).catch(() => undefined);
    return png ? pngDataUrl(pngPath) : null;
  })();
  fetchesInProgress.set(key, preview);
  void preview.finally(() => fetchesInProgress.delete(key)).catch(() => {});
  return preview;
}

let runningFetches = 0;
const waitingFetches: Array<() => void> = [];

async function limitFetches<T>(task: () => Promise<T>): Promise<T> {
  if (runningFetches < MAX_FETCHES) runningFetches += 1;
  else await new Promise<void>((start) => waitingFetches.push(start));
  try {
    return await task();
  } finally {
    // hand this slot straight to the next fetch, or free it
    const next = waitingFetches.shift();
    if (next) next();
    else runningFetches -= 1;
  }
}

/** The site's icon: the best two from the home page's <link> tags, then
 *  /favicon.ico, then an svg. */
async function findSiteIcon(
  origin: string,
  app: TinyApp,
): Promise<Uint8Array | null> {
  // a slow or broken home page still leaves /favicon.ico to try
  const homePage = await fetchHtml(origin, isLocalAddress).catch(() => null);
  const icons = homePage ? findIcons(homePage.html, homePage.url) : [];
  const bitmapIcons = icons.filter((icon) => !icon.isSvg).slice(0, 2);
  const svgIcon = icons.find((icon) => icon.isSvg);
  const tryOrder = [
    ...bitmapIcons.map((icon) => icon.url),
    `${origin}/favicon.ico`,
    ...(svgIcon ? [svgIcon.url] : []),
  ];
  for (const iconUrl of tryOrder) {
    const png = await downloadThumbnail(iconUrl, app);
    if (png) return png;
  }
  return null;
}

/** The page's own image (og:image, twitter:image). */
async function findPageImage(
  pageUrl: string,
  app: TinyApp,
  size = PREVIEW_SIZE,
): Promise<Uint8Array | null> {
  // a redirect can lead to a link that's no safer to open than the copied one
  const page = await fetchHtml(
    pageUrl,
    (url) => isLocalAddress(url) || !canOpenPage(url),
  );
  const imageUrl = page && findPageImageUrl(page.html, page.url);
  return imageUrl ? downloadThumbnail(imageUrl, app, size) : null;
}

/** GET a URL, following redirects one at a time so none of them leads to an
 *  address `isBlocked` rules out, each to the address checked for it
 *  (pinnedGet). Null for a blocked address, too many redirects or an error
 *  status; rejects when the site can't be reached. */
async function fetchFollowingRedirects(
  url: string,
  accept: string,
  maxBytes: number,
  isBlocked: (url: URL) => boolean,
): Promise<{ response: PinnedResponse; url: URL } | null> {
  const deadline = Date.now() + FETCH_TIMEOUT;
  let target = new URL(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (isBlocked(target)) return null;
    const address = await publicAddressOf(target);
    if (!address) return null;
    const timeoutMs = deadline - Date.now();
    if (timeoutMs <= 0) throw new Error(`${target.origin} took too long`);
    const response = await pinnedGet(target, address, {
      accept,
      userAgent: USER_AGENT,
      maxBytes,
      timeoutMs,
    });
    const location =
      response.status >= 300 && response.status < 400
        ? (response.headers.get("location") ?? null)
        : null;
    if (!location && response.status >= 200 && response.status < 300)
      return { response, url: target };
    if (!location) return null;
    if (!URL.canParse(location, target)) return null;
    target = new URL(location, target);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return null;
    }
  }
  return null;
}

async function fetchHtml(
  url: string,
  isBlocked: (url: URL) => boolean,
): Promise<{ html: string; url: string } | null> {
  const fetched = await fetchFollowingRedirects(
    url,
    "text/html,application/xhtml+xml",
    MAX_HTML_BYTES,
    isBlocked,
  );
  if (!fetched?.response.headers.get("content-type")?.includes("html"))
    return null;
  // the page's own address after redirects, for its relative links
  return {
    html: new TextDecoder().decode(fetched.response.body),
    url: fetched.url.href,
  };
}

// Quick Look picks a format by file extension
const imageExtensions: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
  "image/bmp": "bmp",
};

/** Download an image and shrink it to a `size` png. Null when it isn't
 *  an image: Quick Look would turn anything else into a document icon. */
async function downloadThumbnail(
  url: string,
  app: TinyApp,
  size = PREVIEW_SIZE,
): Promise<Uint8Array | null> {
  const fetched = await fetchFollowingRedirects(
    url,
    "image/*",
    MAX_IMAGE_BYTES,
    isLocalAddress,
  );
  const contentType = fetched?.response.headers
    .get("content-type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  const extension = contentType && imageExtensions[contentType];
  if (!fetched || !extension) return null;
  // an image cut short is no image
  const image = fetched.response.cut ? null : fetched.response.body;
  if (!image?.length) return null;

  const folder = await cacheFolder(app);
  const imagePath = `${folder}/download-${generateUUID()}.${extension}`;
  await tjs.makeDir(folder, { recursive: true });
  await tjs.writeFile(imagePath, image);
  try {
    const thumbnail = await app.thumbnail(imagePath, size);
    const png = await tjs.readFile(thumbnail.path);
    await tjs.remove(thumbnail.path).catch(() => undefined);
    return png;
  } catch (error) {
    logError(`link preview thumbnail failed for ${url}:`, error);
    return null;
  } finally {
    await tjs.remove(imagePath).catch(() => undefined);
  }
}
