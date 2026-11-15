// What a page's <head> says about its pictures: the site's icons and the
// page's share image. The Mac and the phone both pick a link's preview from
// these.

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
 *  it shows on any background), then the largest. An svg comes last: the
 *  Mac's Quick Look draws it at its own size, often 16 px in the corner of a
 *  white square. */
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
