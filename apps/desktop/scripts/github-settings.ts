// Applies Teneo's GitHub settings (docs/release-process.md › GitHub settings):
// protected main and release tags, Actions limited to known actions pinned by
// SHA, a "release" environment only main can use, immutable releases and
// secret scanning. Safe to run again. Needs gh signed in with admin rights on
// the repository; sign out afterwards (gh auth logout).
//   bun run release:github-settings [--dry-run]
/* oxlint-disable no-console -- a command-line script reports on the console */
import { spawnSync } from "node:child_process";

import { ghArgs } from "./gh-command.ts";
import { OPTIONAL_SECRETS, SIGNING_SECRETS } from "./release-manifest.ts";

const dryRun = process.argv.includes("--dry-run");
const GITHUB_ACTIONS_APP = 15368; // status checks must come from GitHub Actions itself
const REQUIRED_CHECKS = ["Typecheck", "Test", "Lint", "Format"]; // checks.yml's jobs

function gh(method: string, path: string, body?: unknown): unknown {
  if (dryRun && method !== "GET") {
    console.log(
      `    would ${method} ${path}${body === undefined ? "" : ` ${JSON.stringify(body)}`}`,
    );
    return null;
  }
  const args = [
    "api",
    "--method",
    method,
    path,
    ...(body === undefined ? [] : ["--input", "-"]),
  ];
  const result = spawnSync(...ghArgs(args), {
    input: body === undefined ? undefined : JSON.stringify(body),
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(result.stderr.trim() || `${method} ${path} failed`);
  return result.stdout.trim() ? JSON.parse(result.stdout) : null;
}

let failed = 0;
function step(what: string, apply: () => void): void {
  try {
    apply();
    console.log(`✓ ${what}`);
  } catch (error) {
    failed++;
    console.log(`✗ ${what}\n    ${(error as Error).message}`);
  }
}

const repository = spawnSync(
  ...ghArgs([
    "repo",
    "view",
    "--json",
    "nameWithOwner",
    "-q",
    ".nameWithOwner",
  ]),
  { encoding: "utf8", stdio: ["inherit", "pipe", "inherit"] },
).stdout.trim();
if (!repository)
  throw new Error("gh isn't signed in, or this isn't the repository folder");
const at = (path: string) => `repos/${repository}/${path}`;
const { owner } = gh("GET", `repos/${repository}`) as {
  owner: { id: number; login: string };
};
console.log(`${dryRun ? "Dry run for" : "Applying to"} ${repository}\n`);

step(
  "Actions: only GitHub's own actions and oven-sh/setup-bun, each pinned to a full commit SHA",
  () => {
    gh("PUT", at("actions/permissions"), {
      enabled: true,
      allowed_actions: "selected",
      sha_pinning_required: true,
    });
    gh("PUT", at("actions/permissions/selected-actions"), {
      github_owned_allowed: true,
      verified_allowed: false,
      patterns_allowed: ["oven-sh/setup-bun@*"],
    });
  },
);

step(
  "Actions: a workflow's token can only read unless it asks for more, and can't approve pull requests",
  () => {
    gh("PUT", at("actions/permissions/workflow"), {
      default_workflow_permissions: "read",
      can_approve_pull_request_reviews: false,
    });
  },
);

step(
  "Actions: runs for outside contributors' pull requests wait for your approval",
  () => {
    gh("PUT", at("actions/permissions/fork-pr-contributor-approval"), {
      approval_policy: "all_external_contributors",
    });
  },
);

step(
  `Environment "release": usable from main only, and each run waits for ${owner.login} to approve it`,
  () => {
    gh("PUT", at("environments/release"), {
      wait_timer: 0,
      prevent_self_review: false,
      reviewers: [{ type: "User", id: owner.id }],
      deployment_branch_policy: {
        protected_branches: false,
        custom_branch_policies: true,
      },
    });
    const existing = dryRun
      ? { branch_policies: [] }
      : (gh("GET", at("environments/release/deployment-branch-policies")) as {
          branch_policies: { name: string }[];
        });
    if (!existing.branch_policies.some((policy) => policy.name === "main")) {
      gh("POST", at("environments/release/deployment-branch-policies"), {
        name: "main",
        type: "branch",
      });
    }
  },
);

const rulesets = gh("GET", at("rulesets?per_page=100")) as {
  id: number;
  name: string;
}[];
function ruleset(body: { name: string } & Record<string, unknown>): void {
  const existing = rulesets.find((candidate) => candidate.name === body.name);
  if (existing) gh("PUT", at(`rulesets/${existing.id}`), body);
  else gh("POST", at("rulesets"), body);
}

step(
  "main: changes only through pull requests that pass Typecheck, Test, Lint and Format; no force-push or deletion",
  () => {
    ruleset({
      name: "Protect main",
      target: "branch",
      enforcement: "active",
      bypass_actors: [],
      conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
      rules: [
        { type: "deletion" },
        { type: "non_fast_forward" },
        {
          type: "pull_request",
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
            allowed_merge_methods: ["merge", "squash", "rebase"],
          },
        },
        {
          type: "required_status_checks",
          parameters: {
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: false,
            required_status_checks: REQUIRED_CHECKS.map((context) => ({
              context,
              integration_id: GITHUB_ACTIONS_APP,
            })),
          },
        },
      ],
    });
  },
);

step("Release tags (v*, android-v*): never moved or deleted", () => {
  ruleset({
    name: "Protect release tags",
    target: "tag",
    enforcement: "active",
    bypass_actors: [],
    conditions: {
      ref_name: {
        include: ["refs/tags/v*", "refs/tags/android-v*"],
        exclude: [],
      },
    },
    rules: [
      { type: "deletion" },
      { type: "update" },
      { type: "non_fast_forward" },
    ],
  });
});

step("Releases: immutable once published (files and tag locked)", () => {
  gh("PUT", at("immutable-releases"));
});

step(
  "Secret scanning, and push protection that blocks pushes holding a secret",
  () => {
    gh("PATCH", `repos/${repository}`, {
      security_and_analysis: {
        secret_scanning: { status: "enabled" },
        secret_scanning_push_protection: { status: "enabled" },
      },
    });
  },
);

// The signing secrets belong to the environment, set from 1Password
// (release:secrets). Then the repository-wide copies Doppler's sync made go,
// with the sync's own bookkeeping secrets.
step(
  "Signing secrets: kept in the release environment only, none left from Doppler",
  () => {
    const names = (path: string) =>
      (
        (gh("GET", at(path)) as { secrets: { name: string }[] } | null)
          ?.secrets ?? []
      ).map((secret) => secret.name);
    const inEnvironment = dryRun ? [] : names("environments/release/secrets");
    const repositoryWide = names("actions/secrets");
    const missing = SIGNING_SECRETS.filter(
      (name) => !inEnvironment.includes(name),
    );
    if (missing.length > 0 && !dryRun) {
      throw new Error(
        `the release environment has no ${missing.join(", ")} yet: run \`bun run release:secrets\`, then this again`,
      );
    }
    // an optional one goes only once the environment has its own copy
    const leftovers = repositoryWide.filter(
      (name) =>
        SIGNING_SECRETS.includes(name) ||
        name.startsWith("DOPPLER_") ||
        (OPTIONAL_SECRETS.includes(name) && inEnvironment.includes(name)),
    );
    for (const name of leftovers) gh("DELETE", at(`actions/secrets/${name}`));
  },
);

console.log(
  failed
    ? `\n${failed} setting(s) not applied; see above.`
    : "\nAll settings applied.",
);
if (!dryRun) console.log("Sign gh out when you're done: gh auth logout");
process.exit(failed ? 1 : 0);
