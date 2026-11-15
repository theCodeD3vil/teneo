// Previews for copied links, as on the Mac (apps/desktop/backend/
// link-previews.ts): the site's icon, or the page's own image when the site
// has none. Teneo asks the site itself, never a favicon service, so no one
// else learns which links were copied.
//
// Opening a link can do something: sign-in, password-reset and unsubscribe
// links work once. So the copied page is opened only for the image fallback
// and only when the link doesn't look like one of those; icons come from the
// site's home page. Links to this phone or its local network are never
// fetched. The rules for both are the Mac's (@teneo/shared/links).
//
// The page can't read other sites, so native code makes each request
// (LinkFetchPlugin.java) and the page does the rest: it reads the HTML, and
// draws the picture small, which the web view can do for every format a site
// may use, .ico and .svg among them.
import { findLink } from "@teneo/shared/detection/links";
import { findIcons, findPageImageUrl } from "@teneo/shared/links/page-tags";
import { canOpenPage, isLocalAddress } from "@teneo/shared/links/safety";
import type { LinkPreviewImage } from "@teneo/shared/types/clipboard";

/** The card's icon, in CSS pixels */
export const previewSize = 64;
/** The item preview's 288 px picture */
export const largePreviewSize = 300;
/** a preview, or the note that a site has none, is fetched again after this */
export const cacheLifetimeMs = 7 * 24 * 60 * 60 * 1000;
export const maxHtmlBytes = 256 * 1024;
export const maxImageBytes = 2 * 1024 * 1024;
const maxRedirects = 5;
/** a list full of new links shouldn't open dozens of connections at once */
const maxFetches = 4;

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/svg+xml",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/bmp",
]);

/** One answer from a site. Redirects are not followed: each one is checked
 *  first. */
export type FetchedPage =
  /** its name leads to this phone or the local network: never asked */
  | { blocked: true }
  | {
      blocked?: false;
      status: number;
      /** where a redirect leads */
      location: string | null;
      contentType: string | null;
      /** null when it was longer than allowed */
      body: Uint8Array | null;
    };

export interface LinkFetcher {
  /** Rejects when the site can't be reached. */
  get(request: {
    url: string;
    accept: string;
    maxBytes: number;
    /** take the start of a longer answer instead of none of it */
    allowCut: boolean;
  }): Promise<FetchedPage>;
}

export interface PreviewCache {
  get(key: string): Promise<{ image: string | null; savedAt: number } | null>;
  set(key: string, image: string | null, savedAt: number): Promise<void>;
  /** Forget the previews saved before `time` */
  removeOlderThan(time: number): Promise<void>;
}

export interface LinkPreviewsOptions {
  fetcher: LinkFetcher;
  cache: PreviewCache;
  /** Draw an image no larger than `size` CSS pixels, as a data: URL; null
   *  when it isn't an image the web view can draw. */
  thumbnail: (
    image: Uint8Array,
    contentType: string,
    size: number,
  ) => Promise<string | null>;
  now?: () => number;
}

export class LinkPreviews {
  private readonly fetcher: LinkFetcher;
  private readonly cache: PreviewCache;
  private readonly thumbnail: LinkPreviewsOptions["thumbnail"];
  private readonly now: () => number;
  // two cards with links to the same site wait on one fetch
  private readonly inProgress = new Map<string, Promise<string | null>>();
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(options: LinkPreviewsOptions) {
    this.fetcher = options.fetcher;
    this.cache = options.cache;
    this.thumbnail = options.thumbnail;
    this.now = options.now ?? Date.now;
  }

  /** A link's small picture as a data: URL, or null when the site has
   *  nothing to show. Rejects when the site can't be reached, so the app
   *  tries again later instead of remembering that there's no preview. */
  async icon(url: string): Promise<string | null> {
    const page = publicPage(url);
    if (!page) return null;
    const siteIcon = await this.cached(`site-${page.origin}`, () =>
      this.findSiteIcon(page.origin),
    );
    if (siteIcon || !canOpenPage(page)) return siteIcon;
    return this.cached(`page-${page.href}`, () =>
      this.findPageImage(page.href, previewSize),
    );
  }

  /** The picture for a link's item preview, the most specific first: the
   *  copied page's own image when it's safe to open, the home page's image,
   *  then the site's icon. Null when there's none. */
  async image(url: string): Promise<LinkPreviewImage | null> {
    const page = publicPage(url);
    if (!page) return null;
    const isHomePage = page.href === new URL(page.origin).href;
    if (!isHomePage && canOpenPage(page)) {
      const image = await this.cached(`page-large-${page.href}`, () =>
        this.findPageImage(page.href, largePreviewSize),
      );
      if (image) return { image, source: "page" };
    }
    const homeImage = await this.cached(`home-large-${page.origin}`, () =>
      this.findPageImage(page.origin, largePreviewSize),
    );
    if (homeImage) return { image: homeImage, source: "home" };
    // the card's icon, so it's usually saved already
    const icon = await this.cached(`site-${page.origin}`, () =>
      this.findSiteIcon(page.origin),
    );
    return icon ? { image: icon, source: "icon" } : null;
  }

  /** Forget previews older than the cache's lifetime. They'd be fetched
   *  again anyway, and this keeps icons of links long gone from history off
   *  the phone. */
  removeStale(): Promise<void> {
    return this.cache.removeOlderThan(this.now() - cacheLifetimeMs);
  }

  /** The saved preview `key`, made with `make` when there's none yet. A site
   *  without a preview is saved as null, so it isn't asked again. */
  private cached(
    key: string,
    make: () => Promise<string | null>,
  ): Promise<string | null> {
    const inProgress = this.inProgress.get(key);
    if (inProgress) return inProgress;
    const preview = (async () => {
      const saved = await this.cache.get(key).catch(() => null);
      const age = saved ? this.now() - saved.savedAt : Infinity;
      // a clock set back would otherwise keep a preview for ever
      if (saved && age >= 0 && age < cacheLifetimeMs) return saved.image;
      const image = await this.limited(make);
      // a preview that can't be saved still shows this once
      await this.cache.set(key, image, this.now()).catch(() => undefined);
      return image;
    })();
    this.inProgress.set(key, preview);
    void preview
      .finally(() => this.inProgress.delete(key))
      .catch(() => undefined);
    return preview;
  }

  private async limited<T>(task: () => Promise<T>): Promise<T> {
    if (this.running < maxFetches) this.running += 1;
    else await new Promise<void>((start) => this.waiting.push(start));
    try {
      return await task();
    } finally {
      // hand this slot straight to the next fetch, or free it
      const next = this.waiting.shift();
      if (next) next();
      else this.running -= 1;
    }
  }

  /** The site's icon: the best two from the home page's <link> tags, then
   *  /favicon.ico, then an svg. */
  private async findSiteIcon(origin: string): Promise<string | null> {
    // a slow or broken home page still leaves /favicon.ico to try
    const homePage = await this.fetchHtml(origin, isLocalAddress).catch(
      () => null,
    );
    const icons = homePage ? findIcons(homePage.html, homePage.url) : [];
    const bitmapIcons = icons.filter((icon) => !icon.isSvg).slice(0, 2);
    const svgIcon = icons.find((icon) => icon.isSvg);
    const tryOrder = [
      ...bitmapIcons.map((icon) => icon.url),
      `${origin}/favicon.ico`,
      ...(svgIcon ? [svgIcon.url] : []),
    ];
    for (const iconUrl of tryOrder) {
      const image = await this.downloadThumbnail(iconUrl, previewSize);
      if (image) return image;
    }
    return null;
  }

  /** The page's own image (og:image, twitter:image). */
  private async findPageImage(
    pageUrl: string,
    size: number,
  ): Promise<string | null> {
    // a redirect can lead to a link that's no safer to open than the copied one
    const page = await this.fetchHtml(
      pageUrl,
      (url) => isLocalAddress(url) || !canOpenPage(url),
    );
    const imageUrl = page && findPageImageUrl(page.html, page.url);
    return imageUrl ? this.downloadThumbnail(imageUrl, size) : null;
  }

  /** GET a URL, following redirects one at a time so none of them leads to
   *  an address `isBlocked` rules out. Null for a blocked address, too many
   *  redirects, an error status or an answer that is too long; rejects when
   *  the site can't be reached. */
  private async fetchFollowingRedirects(
    url: string,
    accept: string,
    maxBytes: number,
    allowCut: boolean,
    isBlocked: (url: URL) => boolean,
  ): Promise<{ contentType: string; body: Uint8Array; url: string } | null> {
    let target = new URL(url);
    for (let redirect = 0; redirect <= maxRedirects; redirect++) {
      if (isBlocked(target)) return null;
      const answer = await this.fetcher.get({
        url: target.href,
        accept,
        maxBytes,
        allowCut,
      });
      if (answer.blocked) return null;
      const isRedirect = answer.status >= 300 && answer.status < 400;
      const location = isRedirect ? answer.location : null;
      if (!location) {
        const isOk = answer.status >= 200 && answer.status < 300;
        if (!isOk || !answer.body || !answer.contentType) return null;
        return {
          contentType: answer.contentType,
          body: answer.body,
          url: target.href,
        };
      }
      if (!URL.canParse(location, target)) return null;
      target = new URL(location, target);
      if (target.protocol !== "https:" && target.protocol !== "http:") {
        return null;
      }
    }
    return null;
  }

  private async fetchHtml(
    url: string,
    isBlocked: (url: URL) => boolean,
  ): Promise<{ html: string; url: string } | null> {
    const page = await this.fetchFollowingRedirects(
      url,
      "text/html,application/xhtml+xml",
      maxHtmlBytes,
      true,
      isBlocked,
    );
    if (!page?.contentType.includes("html")) return null;
    // the page's own address after redirects, for its relative links
    return { html: new TextDecoder().decode(page.body), url: page.url };
  }

  /** Download an image and draw it small. Null when it isn't an image. */
  private async downloadThumbnail(
    url: string,
    size: number,
  ): Promise<string | null> {
    const image = await this.fetchFollowingRedirects(
      url,
      "image/*",
      maxImageBytes,
      false,
      isLocalAddress,
    );
    const contentType = image?.contentType.split(";")[0]!.trim().toLowerCase();
    if (!image || !contentType || !imageTypes.has(contentType)) return null;
    if (image.body.length === 0) return null;
    return this.thumbnail(image.body, contentType, size).catch(() => null);
  }
}

/** The link a text is, when it is one a preview may be fetched for */
function publicPage(url: string): URL | null {
  const link = findLink(url);
  if (!link) return null;
  const page = new URL(link.url);
  return isLocalAddress(page) ? null : page;
}
