// Copies the secrets CI signs with from 1Password into the GitHub "release"
// environment, which only main can use. Run on your Mac:
//   bun run release:secrets
// They live in one 1Password item, "Teneo signing secrets" (Personal vault),
// with one field per secret, named after it: MACOS_CERTIFICATE_P12 and
// ANDROID_KEYSTORE_P12 hold the .p12 files in base64, the other two their
// passwords. Each value goes from `op read` to `gh secret set` through a pipe,
// never through arguments, the environment or a file.
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";

import {
  SIGNING_ITEM_TITLE,
  SIGNING_SECRETS,
  UPDATE_KEY_VAULT,
} from "./release-manifest.ts";

function fail(message: string): never {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

const repository = spawnSync(
  "gh",
  ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
  {
    encoding: "utf8",
  },
).stdout.trim();
if (!repository)
  fail("gh isn't signed in, or this isn't the repository folder.");

// every field must be there before anything is replaced
console.log(
  `Reading "${SIGNING_ITEM_TITLE}" from 1Password. Approve with Touch ID.`,
);
const item = spawnSync(
  "op",
  [
    "item",
    "get",
    SIGNING_ITEM_TITLE,
    "--vault",
    UPDATE_KEY_VAULT,
    "--format",
    "json",
  ],
  {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  },
);
if (item.status !== 0)
  fail(
    `There is no "${SIGNING_ITEM_TITLE}" item in the ${UPDATE_KEY_VAULT} vault.`,
  );
const labels = (
  (JSON.parse(item.stdout) as { fields?: { label: string }[] }).fields ?? []
).map((field) => field.label);
const missing = SIGNING_SECRETS.filter((name) => !labels.includes(name));
if (missing.length > 0)
  fail(`"${SIGNING_ITEM_TITLE}" has no ${missing.join(", ")} field.`);

for (const name of SIGNING_SECRETS) {
  const reference = `op://${UPDATE_KEY_VAULT}/${SIGNING_ITEM_TITLE}/${name}`;
  const copy = spawnSync(
    "bash",
    [
      "-o",
      "pipefail",
      "-c",
      'op read --no-newline "$1" | gh secret set "$2" --env release --repo "$3"',
      "bash",
      reference,
      name,
      repository,
    ],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (copy.status !== 0)
    fail(
      `Couldn't set ${name}. Is the "release" environment there? (bun run release:github-settings)`,
    );
}
console.log(
  `\n✓ The release environment of ${repository} now holds ${SIGNING_SECRETS.join(", ")}.`,
);
console.log(
  "Run `bun run release:github-settings` again to remove the repository-wide copies Doppler made.",
);
