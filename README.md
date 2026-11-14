<p align="center">
  <img src="apps/desktop/icon.png" alt="Teneo logo" width="128" height="128">
</p>

<h1 align="center">Teneo</h1>

<p align="center">Everything you copy, one click away in your menu bar.</p>

<p align="center">
  <a href="https://github.com/theCodeD3vil/teneo/releases/latest"><strong>Download for macOS</strong></a>
</p>

Teneo is a clipboard manager for your Mac. It sits quietly in the menu bar and remembers everything you copy. Your history is stored locally on your Mac. Nothing ever leaves.

## Installation

Teneo runs on macOS, on both Apple Silicon and Intel Macs.

1. Open the [latest release](https://github.com/theCodeD3vil/teneo/releases/latest) and download the disk image for your Mac:
   - **Apple Silicon** (M1 or later): `teneo-<version>-macos-arm64.dmg`
   - **Intel**: `teneo-<version>-macos-x86_64.dmg`

> Not sure which you have? Open the Apple menu › **About This Mac**. A **Chip** line means Apple Silicon; a **Processor** line means Intel.

2. Open the disk image and drag **Teneo** into **Applications**.
3. Open Teneo from Applications. macOS blocks it the first time, because Teneo isn't notarized by Apple yet. Click **Done**, then go to **System Settings › Privacy & Security**, scroll down to the bottom, and click **Open Anyway** next to the message about Teneo. You only need to do this once.
4. A welcome window walks you through setup. Complete it and Teneo is ready to be used.

### Accessibility permission

Teneo needs Accessibility permission to paste into the app you're using. Without it, Teneo still saves your history and copies items; you just paste them yourself with ⌘V.

You can allow it in either of two ways:

- **In Teneo's setup window.** Click **Grant access**: System Settings opens on the right page. Turn on **Teneo**, then come back, and the setup window moves on by itself. If you chose **Set up later**, open Teneo's Settings (the gear in Teneo's panel) and click **Finish setup** in the banner at the top to bring the setup window back.
- **Manually in System Settings.** Open **System Settings › Privacy & Security › Accessibility** and turn on **Teneo**. If Teneo isn't in the list, click **+** below it and choose Teneo from Applications.

Teneo's **Settings › Security** tab shows whether access is allowed.

### Desktop, Documents and Downloads

When you copy a file from your Desktop, Documents or Downloads folder (or iCloud Drive, or another drive), Teneo shows its preview and size. macOS asks whether Teneo can see each of those folders. Setup asks for all three at once; you can skip it, and macOS asks the first time it's needed.

If you don't allow a folder, files you copy from it still paste, just without a preview. To change your answer, open **System Settings › Privacy & Security › Files and Folders** and find **Teneo**.

### Keychain (only if you encrypt API keys)

**Encrypt API keys** is off unless you turn it on, in setup or in **Settings › Security**. When it's on, Teneo keeps the key that unlocks your saved API keys in your macOS Keychain, and macOS may ask for your Mac password to let Teneo use it. Click **Always Allow** so it doesn't ask every time.

> [!NOTE]
> **macOS asks again after each Teneo update.** Teneo isn't signed with an Apple Developer ID yet, so macOS treats every new version as a new app and asks for your Mac password once more. Enter it and click **Always Allow**. This goes away once Teneo is signed with a Developer ID. If you'd rather not see it, turn off **Encrypt API keys**: your keys stay hidden in history either way.

Teneo keeps itself up to date: when it starts and once a day after that, it looks for a new version and asks before installing it. You can turn this off with **Settings › General › Check for updates**, and check any time from **Settings › About › Check now**.

## Features

- **Remembers everything you copy.** Text, images, files and colors are saved as you copy them, each with the app it came from and when.
- **Finds it fast.** Search your whole history, or narrow it down with the **Files**, **Image**, **Color** and **Text** tabs.
- **Works from the keyboard.** Set your own shortcut to open Teneo from any app, then:

  | Action                                   | Keys       |
  | ---------------------------------------- | ---------- |
  | Move between items                       | `↑` \| `↓` |
  | Move between tabs                        | `←` \| `→` |
  | Copy the selected item                   | `Enter`    |
  | Copy one of the first nine               | `⌘ 1–9`    |
  | Paste the selected item into focused app | `⌘ V`      |
  | Pin or unpin the selected item           | `P`        |
  | Delete the selected item                 | `D`        |
  | Jump to the search field                 | `⌘ /`      |
  | Leave the search field                   | `Esc`      |
  | Preview the selected item                | `Space`    |

  Clicking an item copies it, and double-clicking opens its preview. While a preview is open:

  | Action                        | Keys                    |
  | ----------------------------- | ----------------------- |
  | Go back to the list           | `Esc` \| `Space` \| `←` |
  | Copy the item and close Teneo | `Enter`                 |

- **Pastes for you.** Paste straight into the app you were using, or turn on **Paste on Enter** to paste every time you pick an item. This also happens automatically with the `⌘ + 1-9` hotkeys and `⌘ + V` keys
- **Shows where links go.** A link you copy shows its site's icon and name, so you can tell links apart at a glance. Teneo gets the icon from the site itself, never from a third-party service, and never opens sign-in, password-reset or local network links. Turn it off in **Settings › Security**.
- **Previews any item (beta).** Press `Space` or double-click an item to see it in full. Each preview has **Pin** and **Delete** at the top.
  - **Text** shows in full. Code is highlighted when Teneo recognizes the language, and buttons turn the text into UPPERCASE, lowercase, Capitalized, camelCase, snake_case or kebab-case before you copy it. Text with an API key stays hidden until you click **Reveal**, and has no case buttons.
  - **Links** show the page's own image, or the site's home page image, or its icon, with the full link and an **Open in browser** button.
  - **Images and files** show a large preview, with their name, size or dimensions, and buttons to **Open**, **Show in Finder** and **Copy**. Several files show as a grid.
  - **Colors** show as hex with their CSS name when they have one, in OKLCH, HSL and RGBA with a copy button each, and in five lighter and five darker shades. Click a shade to copy it in any format.
- **Leaves passwords alone.** Anything copied from a password manager is skipped, and you can add any other app you want Teneo to ignore.
- **Hides API keys (beta).** Keys from GitHub, OpenAI, Anthropic, Stripe, AWS and other services, private keys, and passwords in URLs show as asterisks (`***`) in history, but paste in full. Teneo finds them on your Mac and never sends them anywhere. Turn it off in **Settings › Security**, where you can also have them saved encrypted (see [Keychain](#keychain-only-if-you-encrypt-api-keys)).
- **Keeps only what you want.** Choose how long to keep history (1 day to forever), how many items to keep, and how much space it may use. Pinned items always stay, and don't count toward these limits.

### Good to know about previews

- **Previews come from macOS.** Images, PDFs, video and code show their content, as Finder's Quick Look does. Any file type macOS can't draw shows its icon instead.
- **Protected folders need permission.** A file copied from your Desktop, Documents, Downloads, iCloud Drive or another drive shows only an icon until you let Teneo see that folder (see [Desktop, Documents and Downloads](#desktop-documents-and-downloads)). Open, Show in Finder and Copy still work.
- **Link images are fetched from the site itself.** Teneo opens the copied page only when it's safe to: never for sign-in, password-reset, unsubscribe or one-time links, nor for addresses on your Mac or local network. **Settings › Security › Show link previews** turns all of this off.
- **Show in Finder selects the first file** when you copied several. **Open** opens them all.
- **A click copies after a short pause,** so a double-click can open the preview without copying the item first. Keyboard shortcuts copy right away.

## Screenshots

<p align="center">
  <img src="screenshots/clipboard-panel.png" alt="The Teneo panel: a search field, filter tabs and a list of recently copied text, each showing its source app and when it was copied" width="600">
  <br>
  <em>Your clipboard history, searchable and sorted by type</em>
</p>

<p align="center">
  <img src="screenshots/setup-welcome.png" alt="Teneo's welcome window, with the Teneo logo, the title 'Everything you copy, always within reach' and a Continue button" width="480">
  <br>
  <em>A short setup the first time you open Teneo</em>
</p>

<p align="center">
  <img src="screenshots/settings-general.png" alt="Teneo's General settings, with Launch at login and Paste on Enter" width="720">
  <br>
  <em>General settings</em>
</p>

<p align="center">
  <img src="screenshots/settings-hotkeys.png" alt="Teneo's Hotkeys settings, listing the keyboard shortcuts available in the panel" width="720">
  <br>
  <em>Every shortcut, in one place</em>
</p>

## Roadmap

Here's what's planned next. More will be added over time.

- **Previews (in progress, beta).** Open any item in your history to see it in full, and do more with it than copy and paste. A first version is out to try; see [Features](#features).
- **Landing page (done).** A proper home for Teneo, where you can explore what it does and download it.
- **Sync engine.** Keep your clipboard history in your own cloud storage instead of only on your Mac (bring your own cloud).
- **Android app (in progress).** Sync your clipboard history between your Android phone and your Mac. Its screens are built and running on sample data; saving your history on the phone and syncing it come next.

## Development

Teneo is a [Bun](https://bun.sh) workspaces monorepo, with [Turborepo](https://turborepo.dev) running its builds and checks.

| Folder            | What it holds                                                                                                                                       |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/desktop`    | The Mac app: Vue frontend in `src/`, TinyJS backend in `backend/`.                                                                                  |
| `apps/site`       | The landing page.                                                                                                                                   |
| `apps/mobile`     | The Android app (see [Android app](#android-app)).                                                                                                  |
| `packages/ui`     | `@teneo/ui`: the UI components, theme and helpers that the Mac app, the site and the Android app share.                                             |
| `packages/shared` | `@teneo/shared`: the types and constants the app's frontend and backend share. It ships TypeScript source, with no build step.                      |
| `packages/sync`   | `@teneo/sync`: the clipboard sync core (merge rules, protocol, engine), with no runtime of its own. Not turned on yet; its README has the protocol. |

Run these from the repo root:

| Command                                              | What it does                                      |
| ---------------------------------------------------- | ------------------------------------------------- |
| `bun install`                                        | Installs every workspace.                         |
| `bun run desktop`                                    | Runs the app with `tinyjs dev`, on its own data.  |
| `bun run desktop:reset-dev-data`                     | Wipes that dev data (see below).                  |
| `bun run site`                                       | Serves the landing page.                          |
| `bun run mobile`                                     | Serves the Android app in a browser.              |
| `bun run build` \| `typecheck` \| `test`             | Runs that task in every workspace (Turbo caches). |
| `bun run lint` \| `lint:fix` \| `fmt` \| `fmt:check` | Lints and formats the whole repo, once.           |

**A dev run never touches your real history.** `bun run desktop` keeps its own database, images, link previews, settings and Keychain key apart from the installed Teneo's: files go in a `dev` folder inside the app's data and cache folders, and the settings, setup flag and Keychain entry get a `-dev` name. A packaged build is not affected. The dev data starts empty, so the setup window shows on the first dev run.

- `bun run desktop:reset-dev-data` deletes the dev folders and the dev keys and Keychain entry. It leaves the installed app's data alone.
- `TENEO_REAL_DATA=1 bun run desktop` runs on the real data instead, to check a change against a real history. Teneo logs a warning at startup when it does. Back up `~/Library/Application Support/com.michael.teneo` first.
- Teneo allows one instance per app id, so quit the installed Teneo before `bun run desktop`.
- `bun run test:runtime`, from `apps/desktop`, runs the sync tests that need the real TinyJS runtime (`tjs:sqlite` and its network server; `bun test` has neither): the storage tests, the transport tests and the tests of the pid files that clean up after a killed Teneo. It bundles each test with esbuild and runs it with `~/.tinyjs/bin/tjs` on a temp folder, never on your history. Turbo's `test` leaves it out, since it needs that runtime installed.
- `bun run sync:peer <recovery code>` starts a second Teneo device with no window, on the real runtime and in a temp folder of its own, to try syncing against the app or another peer. `--name <name>` names it; `--dir <folder>` keeps its history between runs. It prints what it receives (this is a test tool: item text is shown) and reads commands on stdin: `copy <text>`, `pin <id>`, `unpin <id>`, `delete <id>`, `clear`, `list`, `peers`, `quit`. `bun backend/sync/new-recovery-code.ts`, from `apps/desktop`, prints the recovery code of a new, empty vault to start two peers with. `bun run sync:peer --app` instead runs the peer the way the app runs sync, through the same `SyncManager` and signal handling, with sync off to begin with and a throwaway vault of its own; it also takes `turnon`, `join <recovery code>`, `code`, `secrets on|off`, `off` and `status`, which are what the Sync tab does.
- `bun run sync:check` starts two such peers and checks that they find each other over Bonjour and end up with the same history: a copy, a pin, a delete and a clear, one peer restarted while the other changed things, a client that doesn't speak Teneo refused, no Bonjour process left running afterwards, and a peer that is killed outright (its Bonjour processes outlive it, so a Teneo notes their pids in `bonjour-<pid>.pids` in its cache folder, and the next one ends those, and only those). It ends with a peer run the app's way (`--app`) against a plain one: sync turned on, joined by recovery code, the existing history arriving, changes both ways, the secrets switch, a quit by SIGTERM and a launch that turns sync on by itself, and turning sync off. The first connection can take up to a minute. It needs ports 47823 to 47827 free, so stop any other syncing Teneo or peer first. macOS may ask to let `tjs` find devices on the local network the first time.
- Sync is on in beta builds: while the version in `apps/desktop/tinyjs.json` has a `-beta` suffix, the Sync tab shows in Settings, in `bun run desktop` and in the released app. With a full version it needs `TENEO_SYNC=1 bun run desktop`; without that, sync is hidden and does nothing: no listener, no Bonjour, nothing sent. In the tab, _Turn on_ makes a vault key (kept in the Keychain), _Add a device_ shows the recovery code and a QR code, and _Join_ takes a recovery code from another device. To try it without a second Mac, turn sync on, show the code, and start `bun run sync:peer <recovery code>`.

TinyJS reads everything from the current folder, so run any `tinyjs` command (`dev`, `build`, `publish`) from `apps/desktop`. The release version lives in `apps/desktop/tinyjs.json`.

`tinyjs dev` restarts the backend when a file in `apps/desktop/backend` changes, but not when one in `packages/shared` does (TinyJS only watches a `shared/` folder beside `backend/`). After editing `packages/shared`, restart `bun run desktop` to pick the change up in the backend. The frontend still reloads on its own.

### Android app

`apps/mobile` is the Android app: Vue and Tailwind on the shared `@teneo/ui` components, wrapped with [Capacitor](https://capacitorjs.com). The native project in `apps/mobile/android` is committed.

For now the app runs on sample data. `FakeClient` (`apps/mobile/src/client`) keeps a seeded history in memory and pretends to sync and pair. Screens only talk to the `TeneoClient` interface, so a real client can take its place without changing them.

To build it for a phone you need:

- **Java 21.** `apps/mobile/mise.toml` pins it, and the Android scripts run Gradle through [mise](https://mise.jdx.dev), so run `mise install` in `apps/mobile` once. Newer Java versions break the Android build tools.
- **The Android SDK**, with platform 36.1 and its build tools. Android Studio installs it. Gradle finds it through `ANDROID_HOME`, or `sdk.dir` in `apps/mobile/android/local.properties` (not committed).
- **An Android phone** running Android 10 or later, with USB debugging on, that `adb devices` lists. Scanning the Mac's QR code uses Google's code scanner, so the phone needs Google Play services. Teneo never asks for the camera permission.

Then, from the repo root:

| Command                      | What it does                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run mobile`             | Serves the app at `http://127.0.0.1:5175`. Open it in a phone-sized browser window. The browser can't scan, so it offers the typed recovery code. |
| `bun run mobile:android`     | Builds the app, installs it on the phone and opens it.                                                                                            |
| `bun run mobile:android:dev` | Installs a build that loads the app from `bun run mobile` over USB, so edits show on the phone as you save. Keep `bun run mobile` running.        |

`mobile:android:dev` points the phone at your Mac through `adb reverse`, so it only works while the phone is plugged in. Run `bun run mobile:android` to go back to a build that works on its own. The debug APK lands in `apps/mobile/android/app/build/outputs/apk/debug`.

The Android scripts aren't part of Turbo's `build`, so CI and the Mac release workflow don't need Java or the Android SDK.

#### Releasing the Android app

The Android app releases the way the Mac app does, from its own version: `"version"` in `apps/mobile/package.json`. When a PR is merged into `main` and that version has no `android-v<version>` tag yet, `.github/workflows/release-android.yml` builds a signed APK and publishes it as the GitHub release "Teneo for Android `<version>`", with the PR's title and description as the notes. So bump the version in the PR to ship a release. A PR can bump the Mac version, the Android version or both.

- **The version** is three numbers such as `1.2.3`, the last two under 100, or a beta of one such as `1.2.3-beta.4` (beta numbers 1 to 98). Gradle reads it from `package.json` and makes Android's version code from it (`1.2.3-beta.4` is `1020304`, and `1.2.3` is `1020399`). Android only updates to a larger one, so the version only goes up, and a beta comes before its full release.
- **A beta is a pre-release.** A version with a suffix is published as a GitHub pre-release, for the Mac app too (`0.4.0-beta.1` in `apps/desktop/tinyjs.json`). A pre-release is never "latest", so Macs running a full release are not updated to it; a Mac running a beta updates to the next full release.
- **The signing key** is one PKCS12 keystore holding a key named `teneo`. The workflow reads it from two repo secrets, `ANDROID_KEYSTORE_P12` (the keystore file, base64) and `ANDROID_KEYSTORE_PASSWORD`, which come from Doppler's `prd` config like the Mac certificate. Android only installs an update signed with the key of the app it replaces, so keep a copy of the keystore and its password somewhere safe: without them, nobody who has the app can update it.
- **The release is never marked "latest".** The Mac app updates from `releases/latest`, which has to stay a Mac release.
- `bun run mobile:android:release` makes the same build on your Mac, in `apps/mobile/android/app/build/outputs/apk/release`. It is signed if `TENEO_ANDROID_KEYSTORE` (the keystore's path) and `TENEO_ANDROID_KEYSTORE_PASSWORD` are set, and unsigned, which a phone won't install, if not.
