# Teneo release process

How Teneo is released since 0.4.3, and why. Written on 2026-11-18; Android
signing added on 2026-11-20.

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

1. A PR that bumps `version` in `apps/desktop/tinyjs.json` (the Mac app), in
   `apps/mobile/package.json` (the Android app), or both, is merged into
   `main`, as before. Its title and body are the release notes. They must be
   plain Markdown: CI drops HTML comments and fails on raw HTML, images, or a
   link that isn't https or mail (`scripts/release-notes.ts`), because
   installed Macs up to 0.4.3 show the notes as HTML.
2. The push that merge makes starts `.github/workflows/release.yml`, from
   `main`'s own copy. Its job waits for you to approve the `release`
   environment on github.com (GitHub emails you); only then does it get the
   signing certificate. It builds both CPUs with a pinned TinyJS, signs the
   apps, records build provenance for every file, and creates a **draft**
   release with the disk images, zips and an unsigned `manifest.json`
   (`scripts/package-release.ts`). A draft is invisible, and no app updates
   to it. Each app must be signed with the hardened runtime and none of the
   entitlements that would let other code into it (`scripts/app-signature.ts`),
   or the build fails.

   An Android bump starts `.github/workflows/release-android.yml` the same
   way: it builds the APK, records its provenance, and makes an
   `android-v<version>` **draft** with the APK and an unsigned
   `android-manifest.json` naming its version, version code, size and hash.
   When the PR bumped both apps, the APK goes into the Mac draft too, with
   a plain `android-manifest.json` naming it there: **one release holds
   everything the PR shipped**, and it is the one phones from Android 0.1.3
   update from.

   Phones read their update from Teneo's **update channel**, the
   `beta-channel` release, which also holds Teneo Beta's Mac `manifest.json`:
   `android-manifest.json` for Teneo and `android-beta-manifest.json` for
   Teneo Beta, each signed and naming the APK in the release it ships in
   (`UpdateRules.channelUrl` in the Android app). `release:publish` puts the
   signed manifest there last, once the releases it names are published. The
   `android-v<version>` release is still made, as phones before 0.1.3 look
   only there; once those have updated, it can stop.

3. On the maintainer's Mac:

   ```sh
   cd apps/desktop
   bun run release:publish          # or: bun run release:publish 0.4.3 --android 0.1.3
   ```

   It publishes whichever drafts CI left, the Mac's, the Android one or both,
   after waiting for any release build still running on their commit (a
   published release is locked, so the APK must be in the Mac draft first).

   `scripts/publish-release.ts` checks that CI made every file of the draft,
   that GitHub's provenance proves each zip, disk image and APK came from its
   workflow on `main`, that each downloaded file matches GitHub's digest, that
   each zip's app is signed as above, and that the manifests point at those
   files with matching hashes. It shows the commits and files about to ship,
   and the release notes whole, and asks you to type the versions. It then
   reads the update key from 1Password once (one Touch ID), signs the Mac
   manifest with `tinyjs publish --sign-manifest` and the Android one itself
   (Ed25519 over `teneo-android-update-v1\n` + the manifest, so neither kind
   of signature can stand in for the other), uploads them, publishes the
   releases (and, for a Mac beta, the `beta-channel` manifest), and checks
   what installed apps and phones now see.

Installed Macs from 0.4.3 on accept an update only when its manifest is
signed with a key in `update.publicKey`. Teneo Beta and Teneo Debug keep the
same key (`withIdentity` keeps the `update` block). Phones from the next
Android release on install only an APK that a signed `android-manifest.json`
names, at its size and hash (`SignedManifest.java`, which carries the same
public key; `src/updates/signing-keys.test.ts` fails until the two agree).

**Sync protocol 2 doesn't talk to protocol 1.** The release that brings it
(per-connection keys, salted Bonjour records, one-time pairing codes) has to
ship for the Mac and for Android together: until a device updates, it hears
"update Teneo" from the other.

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
`ANDROID_KEYSTORE_PASSWORD`, the `.p12` files in base64, and
`ANDROID_SIGNING_LINEAGE`, the Android key's proof of rotation (see Rotating
the key). Copy them into the
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
- An Android release published after 2026-11-20 must carry an
  `android-manifest.json` signed with the same key, naming its own APK; every
  other file must come from CI. Before that date, only CI's files.
- Releases from before signing are left alone unless a file changes.
- It reads every page of releases, so a release can't hide behind newer ones.

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

1. `bun run release:key --rotate` makes a second key, saves it in 1Password
   as "Teneo update signing key YYYY-MM-DD", and adds its public key after
   the old one in `tinyjs.json` and in `PUBLIC_KEYS` in
   `apps/mobile/android/app/src/github/java/com/michael/teneo/updates/SignedManifest.java`.
   Release both apps once, signed with the old key. That release carries
   both keys.
2. Sign from then on with the new key (`TENEO_UPDATE_KEY_REF`, which the
   script prints), and later drop the old key from both lists.

**In progress (2026-11-20):** step 1 is done. The new key is "Teneo update
signing key 2026-11-20"; the next release of each app is signed with the old
one, and the ones after it with:

```sh
export TENEO_UPDATE_KEY_REF="op://Personal/Teneo update signing key 2026-11-20/password"
```

## Rotating the signing certificates (2026-11-20)

Both were in Doppler when its login was exposed, so both were replaced. The
old ones are kept, unused, in 1Password as "Teneo signing secrets retired
2026-11-20".

- **Android keystore.** A new key (alias `teneo`, certificate SHA-256
  `df586a20…783f`) and a proof of rotation from the old one (`ce648296…3832`,
  which signed every earlier release), made with `apksigner rotate` and
  rollback off: `ANDROID_SIGNING_LINEAGE`. CI signs each APK with the new key
  and the proof, v3 only (every phone Teneo runs on reads v3; v1 and v2 would
  need the old key). A phone takes it as an ordinary update and from then on
  refuses an APK signed by the old key alone. Tested on Android 36 and 37
  emulators: the published 0.1.2-beta.1 updated to a rotated build, and a
  build signed with the old key was then refused
  (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). The old key is not needed again;
  keep it retired.
- **Google Play's upload key** is the same keystore. Ask for an upload key
  reset in the Play Console (Setup › App signing) with the new certificate
  before the next Play release; until it's done, Play refuses bundles
  signed with the new key. Play signs what phones get with its own key, so
  Play installs need no proof of rotation.
- **Mac certificate.** A new self-signed "Teneo Code Signing" certificate
  (SHA-256 `05953eb9…a86c`). The updater only pins an Apple team, which a
  self-signed certificate doesn't have, so installed apps take the update;
  but macOS treats the app as a new one, so users grant Accessibility again
  and may be asked once to let Teneo read its Keychain items. Say so in the
  release notes.

If the private key is ever lost, installed apps can't be updated: users would
have to download the next version by hand. 1Password keeps the item's history
and backups; keep it that way.

## Not done yet

- **Apple Developer ID and notarization.** The updater then also requires
  updates to come from the same Apple team, and macOS blocks a trojaned
  download at first launch, so the install notes can drop "Open Anyway".
- **Reset the Play upload key** to the new Android certificate (above).
- **Finish rotating the update key**: sign with the new one from the second
  release on, then drop the old one from both lists (Rotating the key).

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
