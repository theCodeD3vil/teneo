# Teneo sync engine: implementation plan

Build device-to-device sync of clipboard history over the local network, for
the Mac app, with a sync core that the Android/iOS app and a Google Drive relay
can reuse later. No sign-in, no server.

## Decisions already made (do not reopen)

- Local-network sync ships first. Google Drive and other relays come later, for
  devices that are not on the same network.
- Text items only for now. Images, files and colors do not sync.
- End-to-end encryption with one vault key shared by a user's devices. The key
  lives in the Keychain. Devices join by QR code (phone) or recovery code.
- Either device may start a connection; both listen when they can. (On a phone
  hotspot the Mac must connect to the phone.)
- Merge rules: latest change wins per field; a delete by the user syncs and is
  permanent; history-limit trims stay local; the history limit is per device.
- Items holding detected secrets do not sync unless the user turns that on.
- The same text copied on two devices ends up as one item.

## Scope of this plan

In: a separate dev data set for `tinyjs dev` runs, `packages/sync` (the core),
desktop storage changes, the Mac
local-network transport, a headless dev peer for testing, backend wiring, and a
Sync tab in Settings.

Out: the mobile app and its native plugin, the hotspot test, the Drive relay,
pairing two Macs by comparing a short code, images/files, writing received
items to the system clipboard, background sync, Windows/Linux discovery.

## Findings from the spikes (already verified on txiki 26.11.0)

- `tjs.serve` gives an HTTP server with WebSocket upgrade; the `WebSocket`
  client works.
- Bonjour works by spawning macOS `dns-sd` (`-R` announce, `-B` browse, `-L`
  resolve). Discovery took 10 to 20 ms.
- The `WebSocket` client fails on `.local` names. Resolve an IPv4 address
  (`dns-sd -G v4 <host>`) and connect to that.
- The runtime `fetch` reads gzip bodies as empty and fails on parallel requests
  to one host. Not needed for LAN sync, but matters for the Drive relay later.
- On an Android hotspot (Pixel 6 Pro, Android 17), a native Android app and the
  Mac reach each other in both directions and Bonjour discovery works both
  ways. Only the phone's browser cannot reach the Mac, because it uses the
  mobile-data network. A listener in an Android foreground service kept
  accepting connections with the app in the background and the screen off
  (tested for 80 seconds, on USB power).
- TinyJS is single-instance per app id, and the data folder
  (`~/Library/Application Support/com.michael.teneo`) and Keychain entries are
  per app id. Today a dev run shares the installed app's real history, which
  phase 0 ends. Two GUI instances on one Mac are not possible; use the dev
  peer (phase 3).
- `tinyjs dev` sets `TINYJS_ICON`, and only it does. `backend/windows.ts`
  already uses that to detect a dev run.

## Design

### Identity and keys

- `deviceId`: random 128-bit id, created once, kept in `app.store`. Device
  name: the Mac's computer name.
- `vaultKey`: 32 random bytes in `app.secrets` (`sync-vault-key`). Derive with
  HKDF-SHA256, one label each: `authKey` (handshake HMAC), `dataKey` (AES-GCM
  for data at rest in a relay, unused until Drive), `tag` (8 bytes, hex, for
  discovery).
- Recovery code: the vault key in Crockford base32, grouped in fours, with a
  checksum group. The QR payload is `teneo://pair?v=1&k=<key>&a=<ip:port,...>`.

### What a synced item is

`ItemRecord` (version 1), the only thing that crosses the wire:

| Field                                                            | Rule on merge                                                 |
| ---------------------------------------------------------------- | ------------------------------------------------------------- |
| `id`, `kind` ("text"), `text`, `createdAt`, `origin` (device id) | Immutable. `text` is null in a tombstone.                     |
| `dateCopied`, `sourceApp`                                        | Larger `dateCopied` wins and brings its `sourceApp`.          |
| `pinned: { at, stamp }`                                          | Larger `stamp` wins. `stamp` is a hybrid logical clock value. |
| `deletedAt`                                                      | Once set it stays set (earliest wins); the text is dropped.   |

`merge(a, b)` must be commutative, associative and idempotent. Every record
from a peer is validated field by field before use; it is untrusted input.

### How devices exchange changes

- Each device keeps a local counter, `syncSeq`. Every write to a synced row,
  whether made locally or applied from a peer, stamps the row with the next
  value. The store also has a random `storeEpoch`, created with the database.
- For each peer, a device remembers how far it has read that peer's counter
  (`epoch`, `seq`). On connect it sends that cursor; the peer answers with every
  eligible row above it, in batches, then keeps sending new changes as they
  happen. A different epoch resets the cursor to zero.
- Applying a batch and saving the new cursor happen in one transaction.
- A row applied from a peer gets a new local `syncSeq`, so it travels on to
  other peers (a phone can get Mac B's items from Mac A). A merge that changes
  nothing writes nothing, which is what stops echoes.
- Eligible to send: `kind = 'text'`, text at most 1 MB, and no detected secrets
  unless `syncSecrets` is on. Tombstones are always sent.
- After applying a batch, run the device's own history trim.
- Same text on two devices: when a new remote item arrives and the newest
  unpinned local item holds the same text (`isRepeatCopy`), keep the item with
  the smaller id, give it the larger `dateCopied`, and tombstone the other.
  Both results are ordinary changes and replicate.

### Connection protocol (version 1)

Over a `Channel` (an ordered, reliable message pipe; WebSocket on the Mac):

1. Both send `hello { v, deviceId, nonce }`. A different `v` closes with a
   clear "update Teneo on the other device" error.
2. Both send a proof: `HMAC(authKey, role | both nonces | both deviceIds)`.
   A wrong proof closes the connection.
3. A session key is derived from `authKey` and both nonces. Every later frame
   is AES-GCM encrypted with a per-direction counter as nonce; a frame out of
   order or failing to decrypt closes the connection.
4. Frames: `state { epoch, name, platform, cursor }`, `changes { epoch, items,
   upTo, more }`, `ping` / `pong` (15 s, close after 45 s of silence).

Batches hold at most 200 items or 256 KB.

### Mac transport

- Listen with `tjs.serve` on port 47823, falling back to the next four ports.
  Accept only private, link-local and loopback source addresses. Limit failed
  handshakes per address.
- Announce `_teneo-sync._tcp` with TXT `vt=<tag>` and `dev=<deviceId>` through
  `dns-sd`. Browse for the same type and ignore other tags and its own id.
- Also try: the default gateway on the five ports (the hotspot case), and the
  last known address of each paired device.
- If two devices connect to each other at once, keep the connection started by
  the smaller device id.
- Reconnect with backoff. Re-announce and re-browse when the Mac's address
  changes or it wakes. Kill every `dns-sd` child on quit.
- Put discovery behind a small interface so Windows/Linux can supply another.

### Desktop storage

- Add columns to `CLIPBOARD_ITEMS` through the existing `addedColumns`
  mechanism: `syncSeq INTEGER`, `pinnedStamp TEXT`, `originDevice TEXT`,
  `createdAt INTEGER`. Add an index on `syncSeq`. Additive only: an older
  Teneo must still open the file.
- New tables `SYNC_META` (key, value) and `SYNC_PEERS` (deviceId, name,
  platform, epoch, receivedSeq, lastAddress, lastSeenAt).
- Stamp `syncSeq` in every write path: insert and repeat-copy bump in
  `saveClipboardItem`, `softDeleteClipboardItem`, `setClipboardItemPinned`.
  Rows with a null `syncSeq` are backfilled at start, which is also how
  existing history gets sent the first time sync is on.
- While sync is on, "Clear history" and a user delete leave a tombstone
  (`deletedAt` set, `value` null, image removed) instead of removing the row.
  History-limit trims still remove rows. A tombstone for an unknown id is
  stored too. Tombstones are removed after 30 days.
- A received item is run through local secret and link detection, and is
  saved encrypted when it holds a secret and `encryptSecrets` is on.

## Phases

Work on a branch off `development` (for example `feat/sync-engine`), one or
more commits per phase. Follow `CLAUDE.local.md`. Do not bump the version.

### 0. Dev data, separate from the real history

Do this first, as its own commit, so no later phase can touch the owner's real
history.

- Add `isDevRun()` to the backend: true when `tjs.env.TINYJS_ICON` is set and
  `TENEO_REAL_DATA` is not `1`.
- In a dev run, `appPaths()` (`backend/paths.ts`, the one place every caller
  gets folders from) returns `data` as `<data>/dev`, created if missing. The
  database (`teneo.sqlite`), saved images and link previews then all live
  there. Check with a search that nothing builds a data path any other way.
- In a dev run, use separate names for everything kept outside that folder:
  the settings key in `app.store` (`settings` becomes `settings-dev`), any
  other `app.store` keys, and every Keychain entry in `app.secrets`
  (`history-encryption-key`, and later `sync-vault-key`). One helper,
  `devName(name)`, used at every such call.
- A packaged build must behave exactly as before: same paths, same names.
  `isDevRun()` is false there because nothing sets `TINYJS_ICON`.
- `TENEO_REAL_DATA=1 bun run desktop` opts back in to the real data, for
  checking a change against a real history. Say so in a startup log line
  whenever real data is in use during a dev run.
- Add `bun run desktop:reset-dev-data`, which deletes the dev folder and the
  dev store keys, and document both in the README's Development section.
- The dev data starts empty, so the setup window shows on the first dev run.
  That is expected.
- The installed app and a dev run still cannot run together (one instance per
  app id); quit the installed app before `bun run desktop`.
- Verify: with the installed app quit, note the real `teneo.sqlite` size and
  modified time, run `bun run desktop`, copy a few things, quit, and confirm
  the real file is unchanged and `dev/teneo.sqlite` holds the copies. Confirm
  the real settings are unchanged too.

### 1. `packages/sync`: the core

Pure TypeScript using only WebCrypto, timers and injected interfaces, so it
runs on txiki, in a mobile web view and under `bun test`. No `tjs`, no Node
APIs, no dependencies.

- `crypto.ts`, `hlc.ts`, `record.ts` (types, validation, `merge`),
  `protocol.ts`, `session.ts` (handshake and encrypted frames), `engine.ts`
  (`SyncEngine`), `channel.ts` (interface plus an in-memory pair for tests),
  `store.ts` (the `SyncStore` interface the app implements).
- Tests (`bun test`):
  - `merge` properties with randomised inputs.
  - Handshake: success, wrong key, replayed frame, tampered frame, version
    mismatch.
  - Three simulated devices over in-memory channels with random copies, pins,
    deletes, disconnects and reconnects all converge to the same state.
  - Epoch reset, batching boundaries, the secrets filter, the same-text rule,
    relay through a middle device.
- Add it to the workspace with `typecheck` and `test` scripts so Turbo runs it.

### 2. Desktop storage

- The schema changes above, the `syncSeq` stamping, tombstones, and
  `backend/sync/sync-store.ts` implementing `SyncStore` on `tjs:sqlite`.
- Keep pure logic out of `database.ts` so it can be unit tested (the repo's
  existing pattern, since `bun test` has no `tjs:sqlite`).
- Add `esbuild` as a dev dependency of `apps/desktop` (TinyJS currently
  fetches it with `npx` on every build) and a script that bundles a file and
  runs it with `~/.tinyjs/bin/tjs`. Use it for a storage test that runs on the
  real runtime against a temp database.

### 3. Mac transport and the dev peer

- `backend/sync/lan-transport.ts` and `backend/sync/discovery-macos.ts`.
- `bun run sync:peer`: a headless second device on the real runtime, with its
  own temp folder and in-memory key store. It takes a recovery code, prints
  what it receives, and accepts `copy <text>`, `pin <id>`, `delete <id>` and
  `list` on stdin.
- An automated check that starts two headless peers, lets them discover each
  other, and asserts they converge, including after one restarts.

### 4. Wiring and UI

- Settings: `syncEnabled`, `syncSecrets` (both local to the device).
- Backend api: turn sync on (creates a vault), join with a recovery code,
  pairing info (QR payload and recovery code), list devices, turn sync off
  (deletes the key, keeps history), set `syncSecrets`. Push a
  `sync-status-changed` event.
- `SyncTab.vue` in `src/components/settings/`: on/off, status and connected
  devices, "Add a device" (QR code and recovery code), "Join" (enter a code),
  the secrets toggle. Use a small QR library with no dependencies.
- Keep the whole feature behind `TENEO_SYNC=1` until the owner says otherwise.

### 5. Verify and document

- Turbo `build typecheck test`, lint and format pass.
- With the installed Teneo quit: `bun run desktop` (dev data), turn sync on, join with
  `bun run sync:peer`, then check both directions for copy, pin, delete, clear
  history, the secrets toggle, and a restart of each side. Check that existing
  history arrives on the peer.
- Build the app and repeat the check with the built app, noting every macOS
  prompt (local network, firewall). TinyJS has no setting for a local-network
  usage string; if the built app cannot discover or listen, stop and report.
- Schema compatibility, on a copy only: copy the real `teneo.sqlite` into the
  dev folder, run the dev app so it migrates the copy, then confirm the
  currently released Teneo build can still open that migrated copy. The real
  file is never migrated by a dev run.
- Document the protocol and record format in `packages/sync/README.md`, and
  the dev peer in the root README.

## Rules for the implementing agent

- Until phase 0 is merged into the working branch, do not start the app at
  all. After it, never set `TENEO_REAL_DATA=1` yourself; that switch is for
  the owner.
- Keep schema changes additive, and never delete or rewrite existing rows
  outside the rules above: the real database is migrated when the owner
  installs a release.
- Sync must be off by default and do nothing (no listener, no `dns-sd`, no
  extra writes beyond `syncSeq`) until turned on.
- Never log the vault key, recovery code or item text.
- If a step cannot be done as written, stop and report instead of working
  around it.

## Needs the repo owner

- When to remove the `TENEO_SYNC=1` flag. Shipping freezes protocol version 1,
  so the intent is to wait until the Android app has exercised it.
- Confirmed by the owner on 2026-11-14: existing history is sent when sync is
  first turned on; received items are not put on the system clipboard; a
  second Mac joins by recovery code only; texts over 1 MB do not sync; the
  feature stays behind `TENEO_SYNC=1` until the owner decides to ship it.
