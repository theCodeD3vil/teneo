import { describe, expect, test } from "bun:test";

import { UpdateCheckError, findUpdate } from "./releases";

const api = "https://api.github.com/repos/theCodeD3vil/teneo";
const digest = "ab".repeat(32);

function asset(version: string, extra: Record<string, unknown> = {}) {
  return {
    name: `Teneo-${version}.apk`,
    size: 9_000_000,
    digest: `sha256:${digest}`,
    browser_download_url: `https://github.com/theCodeD3vil/teneo/releases/download/android-v${version}/Teneo-${version}.apk`,
    ...extra,
  };
}

/** GitHub with these android-v tags, and releases for some of them */
function github(
  tags: string[],
  releases: Record<string, unknown>,
  options: { refsStatus?: number } = {},
) {
  const requested: string[] = [];
  const fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requested.push(url.slice(api.length));
    if (url === `${api}/git/matching-refs/tags/android-v`) {
      if (options.refsStatus) {
        return new Response("", { status: options.refsStatus });
      }
      return Response.json([
        // what matching-refs also returns for a prefix
        { ref: "refs/tags/android-vnext" },
        ...tags.map((tag) => ({ ref: `refs/tags/android-v${tag}` })),
      ]);
    }
    const prefix = `${api}/releases/tags/android-v`;
    if (url.startsWith(prefix)) {
      const release = releases[decodeURIComponent(url.slice(prefix.length))];
      return release
        ? Response.json(release)
        : new Response("", { status: 404 });
    }
    return new Response("", { status: 500 });
  }) as typeof globalThis.fetch;
  return { fetch, requested };
}

describe("findUpdate", () => {
  test("finds the newest full release for a full-release install", async () => {
    const { fetch, requested } = github(["0.1.0", "0.2.0", "0.3.0-beta.1"], {
      "0.2.0": { draft: false, assets: [asset("0.2.0")] },
    });
    expect(await findUpdate("0.1.0", { fetch })).toEqual({
      version: "0.2.0",
      versionCode: 20_099,
      apkUrl: asset("0.2.0").browser_download_url,
      size: 9_000_000,
      sha256: digest,
    });
    expect(requested).toEqual([
      "/git/matching-refs/tags/android-v",
      "/releases/tags/android-v0.2.0",
    ]);
  });

  test("follows GitHub's pages of tags, where the newest may be on a later one", async () => {
    const requested: string[] = [];
    const second = `${api}/git/matching-refs/tags/android-v?page=2`;
    const fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requested.push(url.slice(api.length));
      if (url === `${api}/git/matching-refs/tags/android-v`) {
        return Response.json([{ ref: "refs/tags/android-v0.10.0" }], {
          headers: { link: `<${second}>; rel="next", <${second}>; rel="last"` },
        });
      }
      if (url === second) {
        // names sort as text, so 0.2.0 and 1.0.0 come after 0.10.0
        return Response.json([
          { ref: "refs/tags/android-v0.2.0" },
          { ref: "refs/tags/android-v1.0.0" },
        ]);
      }
      if (url === `${api}/releases/tags/android-v1.0.0`) {
        return Response.json({ assets: [asset("1.0.0")] });
      }
      return new Response("", { status: 404 });
    }) as typeof globalThis.fetch;
    expect((await findUpdate("0.10.0", { fetch }))?.version).toBe("1.0.0");
    expect(requested).toEqual([
      "/git/matching-refs/tags/android-v",
      "/git/matching-refs/tags/android-v?page=2",
      "/releases/tags/android-v1.0.0",
    ]);
  });

  test("a next page that isn't GitHub's API is not followed", async () => {
    const requested: string[] = [];
    const fetch = (async (input: RequestInfo | URL) => {
      requested.push(String(input));
      return Response.json([], {
        headers: { link: '<https://example.org/tags?page=2>; rel="next"' },
      });
    }) as typeof globalThis.fetch;
    expect(await findUpdate("0.1.0", { fetch })).toBeNull();
    expect(requested).toHaveLength(1);
  });

  test("offers a beta install betas and full releases", async () => {
    const releases = {
      "0.2.0-beta.2": { assets: [asset("0.2.0-beta.2")] },
      "0.2.0": { assets: [asset("0.2.0")] },
    };
    const beta = github(["0.2.0-beta.1", "0.2.0-beta.2"], releases);
    expect((await findUpdate("0.2.0-beta.1", beta))?.version).toBe(
      "0.2.0-beta.2",
    );
    const full = github(["0.2.0-beta.2", "0.2.0"], releases);
    expect((await findUpdate("0.2.0-beta.1", full))?.version).toBe("0.2.0");
  });

  test("finds nothing when this is the newest", async () => {
    const { fetch, requested } = github(["0.1.0", "0.2.0"], {});
    expect(await findUpdate("0.2.0", { fetch })).toBeNull();
    expect(await findUpdate("0.3.0-beta.1", { fetch })).toBeNull();
    expect(requested).toEqual([
      "/git/matching-refs/tags/android-v",
      "/git/matching-refs/tags/android-v",
    ]);
  });

  test("passes over a tag with no finished release", async () => {
    const { fetch } = github(["0.2.0", "0.3.0", "0.4.0"], {
      "0.4.0": { draft: true, assets: [asset("0.4.0")] },
      // the workflow failed before the APK was uploaded
      "0.3.0": { assets: [] },
      "0.2.0": { assets: [asset("0.2.0")] },
    });
    expect((await findUpdate("0.1.0", { fetch }))?.version).toBe("0.2.0");
  });

  test("looks at three releases at most", async () => {
    const { fetch, requested } = github(["0.2.0", "0.3.0", "0.4.0", "0.5.0"], {
      "0.2.0": { assets: [asset("0.2.0")] },
    });
    expect(await findUpdate("0.1.0", { fetch })).toBeNull();
    expect(requested).toHaveLength(4);
  });

  test("takes only an APK of that release, from GitHub", async () => {
    const elsewhere = asset("0.2.0", {
      browser_download_url: "https://example.com/Teneo-0.2.0.apk",
    });
    const otherTag = asset("0.2.0", {
      browser_download_url: asset("0.1.0").browser_download_url,
    });
    const { fetch } = github(["0.2.0"], {
      "0.2.0": {
        assets: [
          { ...asset("0.2.0"), name: "Teneo-0.2.0.zip" },
          elsewhere,
          otherTag,
          asset("0.2.0", { size: 0 }),
        ],
      },
    });
    expect(await findUpdate("0.1.0", { fetch })).toBeNull();
  });

  test("leaves the digest out when GitHub has none", async () => {
    const { fetch } = github(["0.2.0"], {
      "0.2.0": { assets: [asset("0.2.0", { digest: null })] },
    });
    expect((await findUpdate("0.1.0", { fetch }))?.sha256).toBeNull();
  });

  test("says why a check failed", async () => {
    const busy = github([], {}, { refsStatus: 403 });
    await expect(findUpdate("0.1.0", busy)).rejects.toThrow(
      "GitHub is busy. Try again later",
    );
    const offline = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(findUpdate("0.1.0", { fetch: offline })).rejects.toThrow(
      "Couldn't reach GitHub",
    );
    await expect(findUpdate("dev", busy)).rejects.toBeInstanceOf(
      UpdateCheckError,
    );
  });
});
