// Previews for copied links: the site's icon, or the page's own image when the
// site has none. Teneo asks the site itself, never a favicon service, so no
// one else learns which links were copied.
//
// Opening a link can do something: sign-in, password-reset and unsubscribe
// links work once. So the copied page is opened only for the image fallback
// and only when the link doesn't look like one of those; icons come from the
// site's home page. Links to this Mac or its local network are never fetched.
import type {
  ClipboardLink,
  LinkPreviewImage,
} from "../shared/types/clipboard";
import { logError, pngDataUrl } from "./files";
import {
  canOpenPage,
  isLocalAddress,
  resolvesToLocalAddress,
} from "./link-safety";
import { appPaths } from "./paths";
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

/** The link in a copied text, when the whole text is one http(s) URL. */
export function findLink(text: string): ClipboardLink | null {
  const trimmed = text.trim();
  if (trimmed.length > 2048 || /\s/.test(trimmed)) return null;
  if (!/^https?:\/\//i.test(trimmed) || !URL.canParse(trimmed)) return null;
  const url = new URL(trimmed);
  if (!url.hostname) return null;
  return { url: url.href, host: url.hostname.replace(/^www\./, "") };
}

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
  if (isLocalAddress(page)) return null;

  const siteIcon = await cached(`site-${await hash(page.origin)}`, app, () =>
    findSiteIcon(page.origin, app),
  );
  if (siteIcon || !canOpenPage(page)) return siteIcon;
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
  if (isLocalAddress(page)) return null;

  const isHomePage = page.href === new URL(page.origin).href;
  if (!isHomePage && canOpenPage(page)) {
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

interface HtmlTag {
  name: string;
  attributes: Map<string, string>;
}

/** The <link> and <meta> tags in the page's <head>. */
function findHeadTags(html: string): HtmlTag[] {
  const headEnd = html.search(/<\/head\s*>|<body[\s>]/i);
  const head = headEnd === -1 ? html : html.slice(0, headEnd);
  return [...head.matchAll(/<(link|meta)\b([^>]*)>/gi)].map((tag) => ({
    name: tag[1].toLowerCase(),
    attributes: new Map(
      [
        ...tag[2].matchAll(
          /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g,
        ),
      ].map((attribute) => [
        attribute[1].toLowerCase(),
        decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4]),
      ]),
    ),
  }));
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'");
}

/** The site's icon links, best first: apple-touch-icon (180 px and opaque, so
 *  it shows on any background), then the largest. An svg comes last: Quick
 *  Look draws it at its own size, often 16 px in the corner of a white square. */
export function findIcons(
  html: string,
  pageUrl: string,
): Array<{ url: string; isSvg: boolean }> {
  const icons = findHeadTags(html).flatMap((tag) => {
    const rel = tag.attributes.get("rel")?.toLowerCase().split(/\s+/) ?? [];
    const href = tag.attributes.get("href");
    if (tag.name !== "link" || !href) return [];
    const isTouchIcon = rel.some((word) => word.startsWith("apple-touch-icon"));
    if (!isTouchIcon && !rel.includes("icon")) return [];
    const url = resolveUrl(href, pageUrl);
    if (!url) return [];
    const sizes = tag.attributes.get("sizes") ?? "";
    const isSvg =
      sizes === "any" ||
      tag.attributes.get("type") === "image/svg+xml" ||
      /\.svg$/i.test(new URL(url).pathname);
    const largestSize = Math.max(
      0,
      ...[...sizes.matchAll(/(\d+)x\d+/gi)].map((size) => Number(size[1])),
    );
    const size = isTouchIcon
      ? 1000 + largestSize
      : isSvg
        ? 0
        : largestSize || 32;
    return [{ url, isSvg, size }];
  });
  return icons
    .sort((a, b) => b.size - a.size)
    .map(({ url, isSvg }) => ({ url, isSvg }));
}

export function findPageImageUrl(html: string, pageUrl: string): string | null {
  const imageNames = [
    "og:image",
    "og:image:url",
    "og:image:secure_url",
    "twitter:image",
    "twitter:image:src",
  ];
  for (const tag of findHeadTags(html)) {
    const name = (
      tag.attributes.get("property") ?? tag.attributes.get("name")
    )?.toLowerCase();
    const content = tag.attributes.get("content");
    if (tag.name === "meta" && name && imageNames.includes(name) && content) {
      const url = resolveUrl(content, pageUrl);
      if (url) return url;
    }
  }
  return null;
}

function resolveUrl(href: string, base: string): string | null {
  if (!URL.canParse(href, base)) return null;
  const url = new URL(href, base);
  return url.protocol === "https:" || url.protocol === "http:"
    ? url.href
    : null;
}

/** GET a URL, following redirects one at a time so none of them leads to an
 *  address `isBlocked` rules out. Null for a blocked address, too many
 *  redirects or an error status; rejects when the site can't be reached. */
async function fetchFollowingRedirects(
  url: string,
  accept: string,
  signal: AbortSignal,
  isBlocked: (url: URL) => boolean,
): Promise<Response | null> {
  let target = new URL(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
    if (isBlocked(target) || (await resolvesToLocalAddress(target))) {
      return null;
    }
    const response = await fetch(target.href, {
      redirect: "manual",
      signal,
      headers: { accept, "user-agent": USER_AGENT },
    });
    const location =
      response.status >= 300 && response.status < 400
        ? response.headers.get("location")
        : null;
    if (!location && response.ok) return response;
    void response.body?.cancel().catch(() => {});
    if (!location) return null;
    if (!URL.canParse(location, target)) return null;
    target = new URL(location, target);
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      return null;
    }
  }
  return null;
}

/** The first `maxBytes` of a response body, or null when it's longer and
 *  `allowCut` is false. */
async function readAtMost(
  response: Response,
  maxBytes: number,
  allowCut: boolean,
): Promise<Uint8Array | null> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (length < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.length;
  }
  if (length >= maxBytes) {
    void reader.cancel().catch(() => {});
    if (!allowCut) return null;
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes.subarray(0, Math.min(length, maxBytes));
}

async function fetchHtml(
  url: string,
  isBlocked: (url: URL) => boolean,
): Promise<{ html: string; url: string } | null> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT);
  const response = await fetchFollowingRedirects(
    url,
    "text/html,application/xhtml+xml",
    signal,
    isBlocked,
  );
  if (!response?.headers.get("content-type")?.includes("html")) return null;
  const bytes = await readAtMost(response, MAX_HTML_BYTES, true);
  // the page's own address after redirects, for its relative links
  const pageUrl = response.url || url;
  return bytes && { html: new TextDecoder().decode(bytes), url: pageUrl };
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
  const signal = AbortSignal.timeout(FETCH_TIMEOUT);
  const response = await fetchFollowingRedirects(
    url,
    "image/*",
    signal,
    isLocalAddress,
  );
  const contentType = response?.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();
  const extension = contentType && imageExtensions[contentType];
  if (!response || !extension) return null;
  const image = await readAtMost(response, MAX_IMAGE_BYTES, false);
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
