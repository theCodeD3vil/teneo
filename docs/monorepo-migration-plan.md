# Teneo monorepo conversion plan

Convert this repo into a Bun workspaces + Turborepo monorepo, so that a
Capacitor (Vue) mobile app and a sync server can be added next. This plan covers
the conversion only. It must not change app behaviour, the bundle id, the
updater URL or the app version.

## Decisions already made

- Package manager: Bun (1.4.0, the version CI pins). Task runner: Turborepo
  (`turbo` ^2.11).
- Mobile will be Capacitor with Vue, so it will later share UI with the desktop
  app. Do not scaffold `apps/mobile`, `apps/sync-server` or `packages/ui` now.
- Package scope: `@teneo/*`.
- Lint and format (`oxlint`, `oxfmt`) run once from the repo root, not through
  Turbo. Turbo runs `build`, `typecheck`, `test` and `dev`.

## Target layout

```
apps/
  desktop/        today's root app (TinyJS project root)
    backend/ src/ public/ resources/
    index.html settings.html setup.html update.html
    tinyjs.json vite.config.ts components.json
    tsconfig.json tsconfig.app.json tsconfig.node.json
    icon.png Credits.html package.json
  site/           today's site/
packages/
  shared/         today's shared/ (@teneo/shared)
.github/ .husky/ .claude/ .agents/ .vscode/ docs/ screenshots/
README.md bun.lock bunfig.toml package.json turbo.json
oxlint.config.ts oxfmt.config.ts .gitignore
```

## Facts about the current repo that the plan relies on

- The root is one app: Vue frontend in `src/`, TinyJS backend in `backend/`,
  four HTML entry points, `tinyjs.json` pointing at `backend/main.ts`.
- `site/` is a separate Vite app with its own `package.json`, `bun.lock`,
  `oxlint.config.ts` and `oxfmt.config.ts`.
- `shared/types/{clipboard,settings,storage,windows}.ts` is imported by 23 files
  in `src/` and `backend/` through relative paths (`../shared/types/...`).
- `backend/tsconfig.json` includes `../src/tiny.d.ts`. There is only one copy of
  `tiny.d.ts` (in `src/`).
- The TinyJS CLI (`~/.tinyjs/cli.js`) resolves everything from the current
  directory, so it must be run from `apps/desktop`. It walks up parent folders
  to find `node_modules` and `node_modules/.bin/esbuild`, so hoisted workspace
  installs work. `esbuild` is not installed locally today; the CLI falls back
  to `npx esbuild`.
- TinyJS treats a `shared/` folder beside `backend/` specially: `tinyjs dev`
  watches it and restarts the backend when it changes. Code in
  `packages/shared` loses that restart (see step 5).
- `.github/workflows/release.yml` reads the version from root `tinyjs.json`
  (sparse checkout), runs `tinyjs publish` at the root and uploads from `dist/`.
- `.husky/pre-commit` runs `lint-staged`, `bunx vue-tsc -b`, and a site
  typecheck when `site/` files are staged.
- A Vercel project named `teneo` is linked at the repo root (`.vercel/`,
  ignored by git). Its Root Directory setting lives in the Vercel dashboard and
  is presumably `site`.

## Steps

Work on a new branch off `development` (for example `chore/monorepo`). Make one
commit per step so each can be reviewed and reverted on its own. Follow
`CLAUDE.local.md` for commit rules. Leave the uncommitted change to
`CLAUDE.local.md` and the untracked `memory-optimization-plan.pdf` alone.

### 1. Move files (moves only, no content edits)

Use `git mv` so history follows the files.

- To `apps/desktop/`: `backend`, `src`, `public`, `resources`, `index.html`,
  `settings.html`, `setup.html`, `update.html`, `tinyjs.json`,
  `vite.config.ts`, `components.json`, `tsconfig.json`, `tsconfig.app.json`,
  `tsconfig.node.json`, `icon.png`, `Credits.html`, `package.json`.
- `site` to `apps/site`.
- `shared` to `apps/desktop/shared` for now. This keeps every relative import
  valid; step 5 turns it into a package.
- Stay at the root: `README.md`, `screenshots/`, `docs/`, `.github/`,
  `.husky/`, `.claude/`, `.agents/`, `.vscode/`, `.gitignore`, `bun.lock`,
  `oxlint.config.ts`, `oxfmt.config.ts`, `CLAUDE.local.md`.

Before moving, delete the ignored build output so nothing stale is left behind:
root `node_modules`, `dist`, `.build`, and `site/node_modules`, `site/dist`.
Leave `.vercel/` at the root.

### 2. Workspace and Turborepo wiring

Root `package.json` (new):

```json
{
  "name": "teneo-monorepo",
  "private": true,
  "type": "module",
  "packageManager": "bun@1.4.0",
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "catalog": {}
  },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "test": "turbo run test",
    "desktop": "cd apps/desktop && tinyjs dev",
    "site": "turbo run dev --filter=@teneo/site",
    "lint": "oxlint",
    "lint:fix": "oxlint --fix",
    "fmt": "oxfmt",
    "fmt:check": "oxfmt --check",
    "prepare": "husky"
  },
  "devDependencies": {
    "husky": "^9.1.7",
    "lint-staged": "^17.6.0",
    "oxfmt": "^0.73.0",
    "oxlint": "^1.88.0",
    "oxlint-tsgolint": "^7.0.2004",
    "turbo": "^2.11.11"
  },
  "lint-staged": {
    "*.{js,jsx,ts,tsx,mjs,cjs}": "bun run lint",
    "*": "oxfmt --no-error-on-unmatched-pattern"
  }
}
```

- Fill `catalog` with the versions both apps already share (`vue`, `vite`,
  `typescript`, `vue-tsc`, `tailwindcss`, `@tailwindcss/vite`,
  `@vitejs/plugin-vue`, `@vue/tsconfig`, `@vueuse/core`, `reka-ui`,
  `class-variance-authority`, `clsx`, `tailwind-merge`, `tw-animate-css`,
  `unplugin-icons`, `@iconify-json/tabler`, `vue-sonner`, `@types/node`) and
  reference them as `"catalog:"` in both apps. Use the exact ranges that are in
  the package files today.
- `apps/desktop/package.json`: rename to `@teneo/desktop`, keep `version` (it
  tracks `tinyjs.json`). Keep `dev`, `build`, `preview`. Add
  `"typecheck": "vue-tsc -b && tsc -p backend/tsconfig.json --noEmit"`. Keep
  `"test": "bun test backend"`. Remove `lint`, `lint:fix`, `fmt`, `fmt:check`,
  `prepare`, the `lint-staged` block, and the `husky`, `lint-staged`, `oxlint`,
  `oxfmt`, `oxlint-tsgolint` dev dependencies. `tinyjs.json` calls
  `bun run build` and `bun run dev`, so those two script names must not change.
- `apps/site/package.json`: rename to `@teneo/site`. Keep `dev`, `build`,
  `preview`, `typecheck`. Remove the lint and format scripts and the three
  `ox*` dev dependencies. Delete `apps/site/oxlint.config.ts`,
  `apps/site/oxfmt.config.ts` and `apps/site/bun.lock`.
- `bunfig.toml` (new, root): pin the linker to hoisted so installs behave as
  they do today (`[install]` `linker = "hoisted"`; confirm the key against
  `bun install --help` for 1.4.0).
- `turbo.json` (new, root):

```json
{
  "$schema": "https://turborepo.dev/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", "!dist/publish/**", "!dist/*.dmg"]
    },
    "typecheck": { "dependsOn": ["^typecheck"] },
    "test": {},
    "dev": { "cache": false, "persistent": true }
  }
}
```

- `.gitignore`: add `.turbo`.
- Root `oxlint.config.ts` and `oxfmt.config.ts`: replace the ignore patterns
  with `**/dist/**`, `**/.build/**`, `apps/*/src/components/ui/**` (keep the
  other existing oxlint entries).
- Run `bun install` at the root with the existing root `bun.lock` in place, so
  resolved versions carry over. Review the lockfile diff and make sure no
  dependency jumped a major version.

### 3. Hooks, CI and docs

- `.husky/pre-commit`: keep `bun run lint-staged`, replace the two typecheck
  parts with `bunx turbo run typecheck` (it covers both apps and is cached).
- `.github/workflows/release.yml`:
  - `version` job: sparse-checkout `apps/desktop/tinyjs.json` and read the
    version from that path. Update the two messages and the header comment that
    name `tinyjs.json`.
  - `release` job: `bun install --frozen-lockfile` stays at the repo root. Add
    `working-directory: apps/desktop` to the "Build and package", "Create
    release" and "Verify update links" steps; their `dist/...` paths then stay
    as they are.
  - Change nothing else (signing, notes, manifest rewrite, pinned versions).
- `README.md`: fix `icon.png` to `apps/desktop/icon.png` and update any
  commands or paths (`site/`, `backend/`, run and build instructions) to the
  new layout, including the new `bun run desktop` and `bun run site` scripts.
- Do not edit `CLAUDE.local.md`; report that its paths are now stale.

### 4. Verify (must all pass before step 5)

- `bun install --frozen-lockfile` succeeds from a clean checkout.
- `bunx turbo run build typecheck test` passes; a second run reports cache
  hits for every task.
- `bun run lint` and `bun run fmt:check` pass with the same results as before
  the move (compare against `development`).
- From `apps/desktop`: `tinyjs dev` opens the panel, a copy shows up in
  history, the settings window opens and the tray icon appears
  (`resources/tray.png`). Then `tinyjs build` produces an app that launches.
- `bun run site` serves the landing page; `apps/site` builds.
- A test commit runs the pre-commit hook successfully.
- `git log --follow apps/desktop/backend/main.ts` shows the old history.

### 5. Extract `@teneo/shared`

- `git mv apps/desktop/shared/types packages/shared/src/types`.
- `packages/shared/package.json`: name `@teneo/shared`, `private`, `type:
  module`, `"exports": { "./types/*": "./src/types/*.ts" }`, a `typecheck`
  script (`tsc --noEmit`) and a small `tsconfig.json` (strict, `noEmit`,
  `moduleResolution: bundler`, `erasableSyntaxOnly`). It ships TypeScript
  source; there is no build step.
- Add `"@teneo/shared": "workspace:*"` to `apps/desktop` and rewrite the 23
  relative imports to `@teneo/shared/types/<name>`.
- Re-run all of step 4. Check specifically that `tinyjs build` bundles the
  backend (esbuild must resolve the workspace package) and that
  `bun test backend` resolves it.
- Known trade-off: `tinyjs dev` no longer restarts the backend when a file in
  `packages/shared` changes. Confirm this, note it in the README, and do not
  work around it. If esbuild cannot resolve the package, stop and report
  instead of adding path hacks; the fallback is to leave `shared/` in
  `apps/desktop`.

## Needs the repo owner

- Vercel: check the project's Root Directory (`vercel project inspect teneo`
  or the dashboard). If it is `site`, it must change to `apps/site` at the
  moment this work is merged to the branch Vercel deploys. The agent must not
  change Vercel settings itself.
- The PR must not bump the version in `tinyjs.json`, so merging it releases
  nothing. The edited release workflow therefore first runs for real on the
  next release; review it carefully in the PR.

## Out of scope (next phases)

- `packages/ui`: shared Vue components, styles and composables for desktop and
  mobile.
- `apps/mobile`: Capacitor + Vue.
- `apps/sync-server` and the sync protocol types in `@teneo/shared`.
- Aligning the TinyJS version CI installs (v0.66.2) with the local one
  (v0.72.1).
