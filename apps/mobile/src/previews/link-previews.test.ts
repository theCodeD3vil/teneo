import { describe, expect, test } from "bun:test";

import {
  cacheLifetimeMs,
  type FetchedPage,
  type LinkFetcher,
  LinkPreviews,
  type PreviewCache,
} from "./link-previews";

const bytes = (text: string) => new TextEncoder().encode(text);

type Answer = FetchedPage | Error;

/** Sites by address; anything else is a 404 */
function site(pages: Record<string, Answer | (() => Answer)>) {
  const asked: string[] = [];
  const fetcher: LinkFetcher = {
    async get({ url }) {
      asked.push(url);
      const page = pages[url];
      const answer = typeof page === "function" ? page() : page;
      if (answer instanceof Error) throw answer;
      return (
        answer ?? { status: 404, location: null, contentType: null, body: null }
      );
    },
  };
  return { fetcher, asked };
}

const html = (text: string): FetchedPage => ({
  status: 200,
  location: null,
  contentType: "text/html; charset=utf-8",
  body: bytes(text),
});
const image = (name: string, contentType = "image/png"): FetchedPage => ({
  status: 200,
  location: null,
  contentType,
  body: bytes(name),
});
const redirect = (location: string): FetchedPage => ({
  status: 302,
  location,
  contentType: null,
  body: null,
});

function memoryCache(): PreviewCache & {
  saved: Map<string, { image: string | null; savedAt: number }>;
} {
  const saved = new Map<string, { image: string | null; savedAt: number }>();
  return {
    saved,
    get: async (key) => saved.get(key) ?? null,
    set: async (key, picture, savedAt) => {
      saved.set(key, { image: picture, savedAt });
    },
    removeOlderThan: async (time) => {
      for (const [key, preview] of saved) {
        if (preview.savedAt < time) saved.delete(key);
      }
    },
  };
}

function previews(
  fetcher: LinkFetcher,
  options: { cache?: PreviewCache; now?: () => number } = {},
) {
  return new LinkPreviews({
    fetcher,
    cache: options.cache ?? memoryCache(),
    // what was drawn, and how large
    thumbnail: async (picture, _type, size) =>
      `drawn:${new TextDecoder().decode(picture)}@${size}`,
    now: options.now,
  });
}

describe("a link's icon", () => {
  test("is the best icon the site's home page names", async () => {
    const { fetcher, asked } = site({
      "https://example.com/": html(
        `<link rel="icon" sizes="32x32" href="/small.png">
         <link rel="apple-touch-icon" href="/touch.png">`,
      ),
      "https://example.com/touch.png": image("touch"),
    });
    expect(
      await previews(fetcher).icon("https://example.com/docs/page?x=1"),
    ).toBe("drawn:touch@64");
    // the copied page itself was never opened
    expect(asked).toEqual([
      "https://example.com/",
      "https://example.com/touch.png",
    ]);
  });

  test("falls back to /favicon.ico, then an svg", async () => {
    const withIco = site({
      "https://example.com/favicon.ico": image("ico", "image/x-icon"),
    });
    expect(await previews(withIco.fetcher).icon("https://example.com/a")).toBe(
      "drawn:ico@64",
    );
    const withSvg = site({
      "https://example.com/": html(`<link rel="icon" href="/icon.svg">`),
      "https://example.com/icon.svg": image("svg", "image/svg+xml"),
    });
    expect(await previews(withSvg.fetcher).icon("https://example.com/a")).toBe(
      "drawn:svg@64",
    );
  });

  test("is the page's own image when the site has no icon", async () => {
    const { fetcher } = site({
      "https://example.com/post": html(
        `<meta property="og:image" content="/share.jpg">`,
      ),
      "https://example.com/share.jpg": image("share", "image/jpeg"),
    });
    expect(await previews(fetcher).icon("https://example.com/post")).toBe(
      "drawn:share@64",
    );
  });

  test("never opens a link that may act when opened", async () => {
    const { fetcher, asked } = site({
      "https://example.com/reset?token=abc": html(
        `<meta property="og:image" content="/share.jpg">`,
      ),
    });
    expect(
      await previews(fetcher).icon("https://example.com/reset?token=abc"),
    ).toBeNull();
    // not even its site's icon: asking would tell the site the link was seen
    expect(asked).toEqual([]);
  });

  test("never asks this phone or the local network", async () => {
    const { fetcher, asked } = site({});
    const local = previews(fetcher);
    for (const url of [
      "http://192.168.1.1/admin",
      "http://localhost:3000/",
      "http://printer.local/",
    ]) {
      expect(await local.icon(url)).toBeNull();
      expect(await local.image(url)).toBeNull();
    }
    expect(asked).toEqual([]);
  });

  test("stops at a redirect to the local network", async () => {
    const { fetcher, asked } = site({
      "https://example.com/": redirect("http://192.168.1.1/"),
      "https://example.com/favicon.ico": redirect("https://10.0.0.1/icon.png"),
    });
    expect(await previews(fetcher).icon("https://example.com/a")).toBeNull();
    expect(asked.some((url) => url.includes("192.168"))).toBe(false);
    expect(asked.some((url) => url.includes("10.0.0.1"))).toBe(false);
  });

  test("follows a few redirects, and gives up on a loop", async () => {
    const moved = site({
      "https://example.com/favicon.ico": redirect("https://cdn.example.com/i"),
      "https://cdn.example.com/i": image("moved"),
    });
    expect(await previews(moved.fetcher).icon("https://example.com/a")).toBe(
      "drawn:moved@64",
    );
    const loop = site({
      "https://example.com/favicon.ico": redirect("/favicon.ico"),
    });
    expect(
      await previews(loop.fetcher).icon("https://example.com/a"),
    ).toBeNull();
    expect(loop.asked.length).toBeLessThan(12);
  });

  test("is not what a site calls an image but isn't, or one too long", async () => {
    const { fetcher } = site({
      "https://example.com/favicon.ico": image("page", "text/html"),
    });
    expect(await previews(fetcher).icon("https://example.com/a")).toBeNull();
    const long = site({
      "https://example.com/favicon.ico": {
        status: 200,
        location: null,
        contentType: "image/png",
        body: null,
      },
    });
    expect(
      await previews(long.fetcher).icon("https://example.com/a"),
    ).toBeNull();
  });

  test("isn't looked for where native code refuses to go", async () => {
    const { fetcher } = site({
      "https://example.com/": { blocked: true },
      "https://example.com/favicon.ico": { blocked: true },
    });
    expect(await previews(fetcher).icon("https://example.com/a")).toBeNull();
  });
});

describe("the saved previews", () => {
  test("a site is asked once, by every link to it", async () => {
    const { fetcher, asked } = site({
      "https://example.com/favicon.ico": image("ico"),
    });
    const service = previews(fetcher);
    const [first, second] = await Promise.all([
      service.icon("https://example.com/a"),
      service.icon("https://example.com/b"),
    ]);
    expect(first).toBe("drawn:ico@64");
    expect(second).toBe("drawn:ico@64");
    await service.icon("https://example.com/c");
    expect(
      asked.filter((url) => url === "https://example.com/favicon.ico"),
    ).toHaveLength(1);
  });

  test("a site with nothing to show isn't asked again for a week", async () => {
    let now = 1_000_000;
    const { fetcher, asked } = site({});
    const service = previews(fetcher, { now: () => now });
    expect(await service.icon("https://example.com/")).toBeNull();
    const first = asked.length;
    expect(await service.icon("https://example.com/")).toBeNull();
    expect(asked.length).toBe(first);
    now += cacheLifetimeMs + 1;
    await service.icon("https://example.com/");
    expect(asked.length).toBeGreaterThan(first);
  });

  test("a site that can't be reached is tried again", async () => {
    let isDown = true;
    const { fetcher } = site({
      "https://example.com/favicon.ico": () =>
        isDown ? new Error("offline") : image("ico"),
    });
    const service = previews(fetcher);
    await expect(service.icon("https://example.com/a")).rejects.toThrow(
      "offline",
    );
    isDown = false;
    expect(await service.icon("https://example.com/a")).toBe("drawn:ico@64");
  });

  test("old ones are forgotten", async () => {
    let now = 1_000_000;
    const cache = memoryCache();
    const { fetcher } = site({
      "https://example.com/favicon.ico": image("ico"),
    });
    const service = previews(fetcher, { cache, now: () => now });
    await service.icon("https://example.com/a");
    expect(cache.saved.size).toBe(1);
    now += cacheLifetimeMs + 1;
    await service.removeStale();
    expect(cache.saved.size).toBe(0);
  });
});

describe("a link's picture", () => {
  test("is the page's image, then the home page's, then the icon", async () => {
    const pages = {
      "https://example.com/post": html(
        `<meta property="og:image" content="/post.jpg">`,
      ),
      "https://example.com/post.jpg": image("post", "image/jpeg"),
      "https://example.com/": html(
        `<meta name="twitter:image" content="/home.jpg">`,
      ),
      "https://example.com/home.jpg": image("home", "image/jpeg"),
      "https://example.com/favicon.ico": image("ico"),
    };
    expect(
      await previews(site(pages).fetcher).image("https://example.com/post"),
    ).toEqual({ image: "drawn:post@300", source: "page" });
    // a link that may act when opened shows nothing, and its site isn't
    // asked: it may be a tracker made for this one copy
    const tracked = site(pages);
    expect(
      await previews(tracked.fetcher).image(
        "https://example.com/login?next=/post",
      ),
    ).toBeNull();
    expect(tracked.asked).toEqual([]);
    expect(
      await previews(
        site({ "https://example.com/favicon.ico": image("ico") }).fetcher,
      ).image("https://example.com/post"),
    ).toEqual({ image: "drawn:ico@64", source: "icon" });
    expect(
      await previews(site({}).fetcher).image("https://example.com/post"),
    ).toBeNull();
  });
});
