# Teneo Android app: implementation plan

Build the Android app's user interface now, against fake data, while the sync
core (`docs/sync-engine-plan.md`) settles on another branch. Storage, capture
and sync are outlined at the end and get their own detailed plan later.

## Decisions already made (do not reopen)

- Capacitor with Vue, in `apps/mobile`.
- This work is the Android app's UI only, with one approved exception: the UI
  building blocks move into a shared package, `packages/ui`, that the Mac
  app, the site and the phone app all use. Changes to the Mac app and the site
  are limited to that move (import paths and stylesheet imports), with no
  change in behaviour or appearance.
- Application id `com.michael.teneo`; minimum Android 10 (API 29).
- First version does: history list, search, pin, delete, tap to copy; pairing
  by scanning the Mac's QR code, with typing the recovery code as fallback;
  settings.
- Text items only.
- Capturing copies made on the phone: when Teneo is opened, and through "Save
  to Teneo" in the share sheet. Background capture through Shizuku is an
  optional later tier.
- Receiving from other devices runs in the background from the start, through
  a foreground service with a permanent notification.
- Android first; iOS later.

## Facts this plan relies on

- The desktop frontend (`apps/desktop/src`) reaches its backend through the
  `tiny` global in 27 files. The feature components (`ClipboardItemCard`,
  `AllTabContent`, `TabManager`, the settings tabs) are built for a 560 px
  keyboard-driven panel with hover actions, and are not reusable on a phone as
  they are.
- What moves into the shared package: the shadcn-vue primitives in
  `apps/desktop/src/components/ui` (28 folders; the site has its own copy),
  the theme tokens in `src/style.css`, `src/lib/utils.ts`, and pure helpers
  (`utils/text-case.ts`, `utils/secrets.ts`, `utils/highlight.ts`,
  `utils/file-size.ts`, `composables/useRelativeTimeAgo.ts`). 25 files across
  the desktop app and the site import the primitives.
- The item types are in `@teneo/shared`. Import them; do not edit that package.
- Capacitor is at 8.6.2 on npm.
- Android builds on this Mac need Java 21. It is installed through `mise`
  (`java@temurin-21`) but is not the default; Java 26, the default, fails in
  the Android build tools. The Android SDK is at `~/Library/Android/sdk`
  (platform 36.1, build-tools 36 and 37). Gradle 9.3.1 and Android Gradle
  plugin 9.1.1 are in the local cache.
- Test phone: Pixel 6 Pro, Android 17, connected over USB with debugging on.
- The Mac is usually tethered to that phone's mobile data. Downloads cost the
  owner data: avoid needless ones and say roughly how much each phase pulled.
- Spike results (native test app on that phone, over its hotspot): the app and
  the Mac reach each other both ways, discovery works both ways, and a
  foreground-service listener kept accepting connections in the background
  and with the screen off. Not yet tested: Capacitor's bridge, battery saving
  over hours, an ordinary Wi-Fi router, Android 17's local-network permission
  for apps built against API 37.

## Working arrangement

- Another agent is working in the main checkout on `feat/sync-engine`. Do not
  share its checkout: create a git worktree
  (`git worktree add ../teneo-mobile -b feat/mobile-ui development`) and work
  there.
- In `apps/desktop` and `apps/site`, change only what phase 1 needs: import
  paths, the stylesheet's theme import and Tailwind source line,
  `components.json`, and the removal of the moved files. Do not edit
  `packages/shared`. If anything else seems to need a change, stop and ask.
- Do not start the desktop app (`bun run desktop`, `tinyjs dev`). Until the
  sync branch's dev-data change is merged, a dev run uses the owner's real
  clipboard history. Check desktop changes with build, typecheck and lint, and
  ask the owner for the visual check.
- Follow `CLAUDE.local.md` for commits. Do not bump any version.

## Design

### Shared UI package (`packages/ui`, `@teneo/ui`)

- Holds the shadcn-vue primitives, the theme tokens and custom variants from
  `style.css`, `cn` from `lib/utils.ts`, and the pure helpers listed above.
- Ships Vue and TypeScript source with no build step, like `@teneo/shared`.
- Each app's stylesheet imports the shared theme and adds a Tailwind
  `@source` for the package folder, so its classes are generated.
- The desktop app and the site import primitives from `@teneo/ui` and drop
  their own copies. Where the two copies of a component differ, keep the
  desktop version and list the differences in the PR for the owner.
- `components.json` in each app points shadcn-vue's aliases at the package, so
  adding a component later lands in one place.
- The Figtree font currently loads from Google Fonts. The phone app must work
  offline, so it bundles the font; the desktop app and the site keep their
  current loading.

### Mobile app (`apps/mobile`, `@teneo/mobile`)

- Vite, Vue, Tailwind and Capacitor 8 with the Android platform. The native
  project in `apps/mobile/android` is committed.
- Feature screens are written for touch and built from `@teneo/ui`
  primitives. They are not ports of the desktop components.
- All data goes through one interface, `TeneoClient`, provided to the app with
  Vue's provide/inject. Screens never import a storage, sync or Capacitor
  module directly.

```ts
interface TeneoClient {
  listItems(request: ClipboardListRequest): Promise<ClipboardListPage>;
  getItem(id: string): Promise<ClipboardHistoryItem | null>;
  setPinned(id: string, pinned: boolean): Promise<void>;
  deleteItem(id: string): Promise<void>;
  copyToClipboard(id: string): Promise<void>;
  onHistoryChanged(listener: () => void): () => void;
  getSettings(): Promise<MobileSettings>;
  updateSettings(changes: Partial<MobileSettings>): Promise<MobileSettings>;
  getSyncStatus(): Promise<SyncStatus>;
  onSyncStatusChanged(listener: (status: SyncStatus) => void): () => void;
  pair(code: string): Promise<PairResult>; // QR payload or recovery code
  unpair(): Promise<void>;
}
```

- This phase ships `FakeClient`: seeded history (a few hundred varied text
  items, including links, long texts, items with detected secrets, pinned
  items and items from several source devices), kept in memory, with
  simulated sync states and a simulated pairing that accepts a well-formed
  `teneo://pair?v=1&k=...` payload. `copyToClipboard` really writes to the
  clipboard.
- `MobileSettings` and `SyncStatus` are new types inside `apps/mobile`.
  `SyncStatus` covers: off, not paired, searching, connected (with a device
  list), and error with a message.

### Screens

1. **Welcome and pairing.** Short welcome, then "Scan the code on your Mac"
   with the camera, then a typed recovery-code fallback, then a success state.
   "Use without pairing" is allowed.
2. **History.** Search field, pinned items first, newest first, virtualised
   list (`@tanstack/vue-virtual`), paged through `listItems`. Each row shows
   the start of the text, when it was copied and where it came from. Tap
   copies and shows a confirmation. Long-press opens a sheet with Pin, Delete,
   Share and View. Empty, loading and no-results states. A small sync
   indicator.
3. **Item view.** Full text, selectable, with Copy, Share, Pin and Delete.
   Secrets are masked until revealed when masking is on.
4. **Settings.** Sync (status, paired devices, "Receive in the background",
   "Sync items that look like secrets", unpair), Capture ("Save what's on the
   clipboard when Teneo opens"), History ("Keep history for", "Maximum
   items"), Security ("Hide secrets"), About (version, links).

Android behaviour to get right: edge-to-edge with safe-area insets, the system
back gesture, the on-screen keyboard not covering the search field or sheets,
light and dark following the system, text scaling, 48 dp touch targets, and
no hover-only affordances.

## Phases

### 1. `packages/ui`

- Create the package and move the primitives, theme and helpers. Update the
  25 importing files, both apps' stylesheets and `components.json` files, and
  the lint and format ignore patterns.
- Keep this as one small PR and get it merged early: the sync branch adds a
  settings tab that imports the same primitives and will need a one-line
  rebase fix. Tell the owner when it is ready so both branches can be lined up.
- Verify: Turbo `build typecheck test`, lint and format pass; the site looks
  the same in a browser at a few widths (screenshots before and after); the
  desktop app's built stylesheet contains the same class names before and
  after. The owner does the desktop visual check.

### 2. Scaffold `apps/mobile`

- Vite and Vue app using `@teneo/ui`, with the bundled font, and `dev`,
  `build` and `typecheck` scripts so Turbo and the pre-commit hook cover it.
- Add Capacitor and the Android platform. App name "Teneo", application
  id `com.michael.teneo`, minimum Android 10 (API 29). Target the newest stable API level Capacitor 8 supports.
- Pin Java 21 for this folder with a `mise.toml` in `apps/mobile`. Android
  builds are separate scripts (`android:run`, `android:build`), not part of
  Turbo's `build`, so CI and the release workflow are unaffected.
- Root scripts: `bun run mobile` (browser dev server) and
  `bun run mobile:android` (build, sync, install and launch on the phone).
- Verify: a themed placeholder screen runs in a desktop browser at phone size
  and on the Pixel, in light and dark, with correct insets and working back
  gesture. `bun install --frozen-lockfile` and the release workflow's steps
  still work from a clean clone.

### 3. `TeneoClient` and `FakeClient`

- The interface, the new types, the fake client and its seed data.
- Unit tests (`bun test`) for the fake client: paging, search, pin order,
  delete, change notifications.

### 4. Screens

- Build the four screens against `FakeClient`, in the order: History, Item
  view, Settings, Welcome and pairing.
- QR scanning uses a maintained Capacitor barcode plugin with on-device
  scanning. Ask for the camera permission only when the user opens the
  scanner, and handle refusal by offering the typed code.
- Verify on the Pixel and in the browser: every state of every screen, both
  themes, large text, long and multi-line items, a 500-item list scrolling
  smoothly, keyboard behaviour, back gesture from every screen and sheet.
  Capture screenshots with `adb exec-out screencap -p` for the owner.

### 5. Wrap up

- README: the mobile folder, the scripts, the Java 21 and Android SDK
  requirements, and how to run on a phone.
- Report: what was built, screenshots, what is fake, data downloaded, and
  anything in this plan that turned out wrong.

## Later phases (outline only; plan in detail once the sync core is merged)

- **Storage:** a real `TeneoClient` on a SQLite database on the phone.
- **Capture:** read the clipboard when the app comes to the front; a share
  target for "Save to Teneo".
- **Sync:** a native plugin for listening, connecting and discovery, feeding
  `packages/sync` through its channel interface; real pairing.
- **Background receive:** the foreground service. Open question to settle by
  a spike first: the sync core is TypeScript, so where does it run when the
  app's screen is gone? Candidates are a web view owned by the service, or a
  native reimplementation of the protocol. The answer also decides whether
  the database is owned by native code. Nothing in phases 1 to 5 depends on it.

## Needs the repo owner

- The desktop visual check after phase 1.
- Merging phase 1 early, and telling the sync branch to rebase.
