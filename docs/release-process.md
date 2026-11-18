# Teneo release process

How Teneo for Mac is released since 0.4.3, and why. Written on 2026-11-18.

## Why it changed

On 16 November 2026 someone published "Teneo 0.4.2" from the maintainer's
GitHub account, with no CI run. It was the 0.4.1 app with a loader added that
installed a backdoor, signed ad hoc, and an update manifest written by hand.
Installed apps updated to it, because the updater trusted any manifest on the
latest release: its sha256 came from the same place as the zip.

A stolen token for the owner's account can do anything the owner can do
through the API: create releases, change workflows and rulesets, approve
deployments. So the one thing that decides what installed apps accept now
lives off GitHub.

## How a release works

1. A PR that bumps `version` in `apps/desktop/tinyjs.json` is merged into
   `main`, as before. Its title and body are the release notes.
2. The push that merge makes starts `.github/workflows/release.yml`, from
   `main`'s own copy. Its job waits for you to approve the `release`
   environment on github.com (GitHub emails you); only then does it get the
   signing certificate. It builds both CPUs with a pinned TinyJS, signs the
   apps, records build provenance for every file, and creates a **draft**
   release with the disk images, zips and an unsigned `manifest.json`
   (`scripts/package-release.ts`). A draft is invisible, and no app updates
   to it.
3. On the maintainer's Mac:

   ```sh
   cd apps/desktop
   bun run release:publish          # or: bun run release:publish 0.4.3
   ```

   `scripts/publish-release.ts` checks that CI made every file of the draft,
   that GitHub's provenance proves each zip and disk image came from
   `release.yml` on `main`, and that the manifest points at those files with
   matching hashes. It shows the
   commits and files about to ship, and asks you to type the version. It then
   reads the update key from 1Password (Touch ID), signs the manifest with
   `tinyjs publish --sign-manifest`, uploads it, publishes the release (and,
   for a beta, the `beta-channel` manifest), and checks what installed apps
   now see.

Installed apps from 0.4.3 on accept an update only when its manifest is
signed with a key in `update.publicKey`. Teneo Beta and Teneo Debug keep the
same key (`withIdentity` keeps the `update` block).

## One-time setup

1. Sign in to the 1Password CLI with the desktop app integration
   (Settings › Developer › Integrate with 1Password CLI), so `op` asks for
   Touch ID.
2. Make the key, then commit the `tinyjs.json` change it makes:

   ```sh
   cd apps/desktop
   bun run release:key              # --vault NAME for a vault other than Personal
   ```

   The private key goes straight into 1Password as "Teneo update signing key"
   and is read back once to check it. Only the public key is printed and
   written.

3. Sign `gh` in when you publish, with a token limited to this repository and
   a short expiry, and sign out after (`gh auth logout`). A long-lived token
   with `repo` and `workflow` scopes on a Mac is what made this attack
   possible.
4. Apply the GitHub settings below, once.

## GitHub settings

`scripts/github-settings.ts` applies them and is safe to run again:

```sh
cd apps/desktop
bun run release:github-settings --dry-run   # what it would change
bun run release:github-settings             # needs gh signed in as an admin
gh auth logout
```

| Setting                                                                                                                 | Why                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `main`: pull requests only, Typecheck, Test, Lint and Format must pass (from GitHub Actions), no force-push or deletion | Nothing reaches `main`, and so no release, without a PR and green checks                          |
| Release tags `v*`, `android-v*`: never moved or deleted                                                                 | A published version always points at the commit it was built from                                 |
| Environment `release`: `main` only, you approve each run                                                                | The signing certificate and keystore reach only release jobs on `main`, and only after you say so |
| Actions: GitHub's own actions and `oven-sh/setup-bun` only, pinned to full SHAs                                         | No other code runs in a workflow, and a moved tag can't swap an action                            |
| Actions: read-only token by default, can't approve PRs                                                                  | A workflow gets write access only where it asks for it                                            |
| Outside contributors' PR runs wait for approval                                                                         | A stranger's PR can't run code in your Actions                                                    |
| Immutable releases                                                                                                      | Once published, a release's files and tag can't be changed                                        |
| Secret scanning and push protection                                                                                     | A pushed secret is caught, or blocked before it lands                                             |

The release workflows run on the push to `main`, not on `pull_request`: a
`pull_request` run uses the PR's own copy of the workflow, which anyone who
can push a branch can write, and environment secrets are only handed to
`main`.

**Signing secrets**: the Apple certificate, the Android keystore and their
passwords live in one 1Password item, "Teneo signing secrets" (Personal
vault), with one field per secret named after it: `MACOS_CERTIFICATE_P12`,
`MACOS_CERTIFICATE_PASSWORD`, `ANDROID_KEYSTORE_P12`,
`ANDROID_KEYSTORE_PASSWORD`, the `.p12` files in base64. Copy them into the
`release` environment, then let the settings script remove the old
repository-wide copies:

```sh
bun run release:secrets            # 1Password → the release environment
bun run release:github-settings    # removes the repository-wide copies
```

**Doppler is out of the pipeline.** Its CLI login was readable by any program
on the maintainer's Mac and was exposed on 18 November 2026, and its GitHub
sync could rewrite the secrets CI signs with. Remove its GitHub integration
(Doppler › Integrations) and its access on GitHub (Settings › Applications).

GitHub's rules hold against any token that lacks admin rights on the
repository. A token with admin rights can change them, which is why day-to-day
tokens should never have it, and why installed apps trust only the update
key, which no token reaches.

## Rules

- **The private update key lives only in 1Password.** Never in GitHub, never
  in another secrets service: installed apps trust it above everything else.
- **The signing secrets come from 1Password** (`release:secrets`) and live in
  GitHub only in the `release` environment. No other service syncs them.
- Don't publish a release by hand on github.com. Use `release:publish`.
- Don't skip the watchdog's issues: each one means a release was pulled.

## The watchdog

`.github/workflows/release-watchdog.yml` runs on every release event and every
30 minutes, with the rules in `scripts/release-manifest.ts`:

- A Mac release published after 2026-11-18 must carry a manifest signed with
  the key in `main`'s `tinyjs.json`, its downloads must be its own files with
  matching hashes, and every file but `manifest.json` must come from CI.
- The `beta-channel` manifest must be signed once it changes, and offer a beta.
- An Android release must hold only CI's files.
- Releases from before signing are left alone unless a file changes.

Anything else is turned back into a draft and reported in an issue. A stolen
token could switch the watchdog off, so it is an alarm, not a wall: the
signature check in installed apps is the wall.

### If the watchdog pulls a release

If you didn't make it, someone can act as your GitHub account:

1. From a clean device: change the GitHub password, sign out all sessions,
   delete every personal access token, and revoke OAuth apps (Settings ›
   Applications) and GitHub Apps you don't need.
2. Check the security log for new tokens and sign-ins.
3. Leave the release as a draft for evidence. Installed apps never saw it.

## Rotating the key

Apps accept any key in `update.publicKey`, so a rotation is two releases:

1. Make a second key, add its public key to the list in `tinyjs.json`
   (`"publicKey": ["old…", "new…"]`), and release once, signed with the old
   key. That release carries both keys.
2. Sign from then on with the new key (`TENEO_UPDATE_KEY_REF`), and later
   drop the old key from the list.

If the private key is ever lost, installed apps can't be updated: users would
have to download the next version by hand. 1Password keeps the item's history
and backups; keep it that way.

## Not done yet

- **Apple Developer ID and notarization.** The updater then also requires
  updates to come from the same Apple team, and macOS blocks a trojaned
  download at first launch, so the install notes can drop "Open Anyway".
- **Rotate the Android keystore.** It was in Doppler when Doppler's login was
  exposed, so treat it as stolen: phones accept any APK signed with it as an
  update. Android's key rotation (APK Signature Scheme v3, `apksigner rotate`)
  moves installed apps to a new key without a reinstall. The Play upload key
  is reset in the Play Console.
- **Signed manifests for Android**, so the Android updater, like the Mac's,
  trusts only updates signed with the update key.
- **Rotate the Apple certificate** together with the move to Developer ID: it
  was in Doppler too, and each certificate change makes users grant
  Accessibility again, so one change is better than two.

## Teneo 0.4.3 release notes (draft for the PR)

This one breaks the usual "no causes" rule on purpose: people who installed
0.4.2 need to know what happened and what to do.

```md
Teneo 0.4.3: removes harmful software installed by a fake update

## Important

- **If you installed Teneo 0.4.2, this update removes harmful software it added.** That version wasn't made by us: someone published it in our name.
- **Change the passwords saved in your browser, and sign out of your accounts on other devices.** The harmful software could read files on your Mac.
- **Updates are now locked to us.** Teneo only installs updates we have signed.
```

Keep the existing Install section below it as it is.
