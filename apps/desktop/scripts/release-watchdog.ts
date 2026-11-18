// The release watchdog (.github/workflows/release-watchdog.yml): checks the
// newest releases against the rules in release-manifest.ts and pulls any
// that breaks them back to a draft at once, then opens an issue, which
// emails the owner. Run from the repository root with GITHUB_TOKEN set.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { readFileSync } from "node:fs";

import {
  checkPublishedRelease,
  publicKeysOf,
  type Release,
} from "./release-manifest.ts";

const token = process.env.GITHUB_TOKEN;
const repository = process.env.GITHUB_REPOSITORY;
if (!token || !repository)
  throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY must be set");

async function api(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/${path}`,
    {
      method: init.method ?? "GET",
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2022-11-28",
      },
    },
  );
  if (!response.ok)
    throw new Error(
      `GitHub answered ${response.status} to ${init.method ?? "GET"} ${path}`,
    );
  return response.status === 204 ? null : response.json();
}

const publicKeys = publicKeysOf(
  JSON.parse(readFileSync("apps/desktop/tinyjs.json", "utf8")),
);
const releases = ((await api("releases?per_page=30")) as Release[]).filter(
  (release) => !release.draft,
);

let pulled = 0;
for (const release of releases) {
  let manifest: unknown = null;
  if (release.assets.some((asset) => asset.name === "manifest.json")) {
    const response = await fetch(
      `https://github.com/${repository}/releases/download/${release.tag_name}/manifest.json`,
    );
    // a failed download is a reason to try again, never to pull a release
    if (!response.ok)
      throw new Error(
        `${release.tag_name}'s manifest.json answered ${response.status}`,
      );
    manifest = await response.json().catch(() => "unreadable");
  }
  const problems = await checkPublishedRelease({
    release,
    manifest,
    publicKeys,
    repository,
  });
  if (problems.length === 0) continue;

  pulled++;
  // An immutable release may refuse to become a draft again: then it goes,
  // and the issue keeps a record of its files.
  const outcome = await api(`releases/${release.id}`, {
    method: "PATCH",
    body: { draft: true },
  }).then(
    () => "turned back into a draft",
    async () => {
      await api(`releases/${release.id}`, { method: "DELETE" });
      return "deleted, as it couldn't become a draft";
    },
  );
  console.log(
    `::error::${release.tag_name} was ${outcome}: ${problems.join("; ")}`,
  );
  const title = `Release ${release.tag_name} was pulled by the release watchdog`;
  const open = (await api("issues?state=open&per_page=100")) as {
    title: string;
  }[];
  if (open.some((issue) => issue.title === title)) continue;
  await api("issues", {
    method: "POST",
    body: {
      title,
      body: [
        `The release watchdog pulled **${release.tag_name}** (${outcome}), so no one can download it or update to it:`,
        "",
        ...problems.map((problem) => `- ${problem}`),
        "",
        "Its files:",
        ...release.assets.map(
          (asset) =>
            `- ${asset.name}, uploaded by ${asset.uploader?.login ?? "nobody"}, ${asset.digest ?? "no digest"}`,
        ),
        "",
        "If you made this release, publish it with `bun run release:publish` from apps/desktop on your Mac, which signs it.",
        "If you didn't, someone else can act as your GitHub account. See docs/release-process.md › If the watchdog pulls a release.",
      ].join("\n"),
    },
  });
}
console.log(`Checked ${releases.length} published releases; pulled ${pulled}.`);
