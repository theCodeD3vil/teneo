# @teneo/sync

The sync core: what two devices that hold the same vault key say to each other
so their clipboard history ends up the same. It is plain TypeScript on top of
WebCrypto, timers and a few interfaces the app provides, with no `tjs`, no Node
APIs and no dependencies. That is so the Mac app (txiki), a mobile web view and
`bun test` can all run it. Nothing in here touches the network or a database.

Protocol version: **1**. Sync is on in beta builds of the Mac app and otherwise behind `TENEO_SYNC=1`;
shipping it freezes this version, so read the rules at the end before changing
anything on the wire.

## What is in it

| File          | What it holds                                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `record.ts`   | `ItemRecord`, the only thing that crosses the wire: validation (`parseRecord`) and the merge rules (`mergeRecords`, `collapseSameText`). |
| `hlc.ts`      | The hybrid logical clock that stamps pins.                                                                                               |
| `crypto.ts`   | Hex, base64, base32, HKDF, HMAC, AES-GCM, the recovery code and the pairing link.                                                        |
| `protocol.ts` | The message shapes, their parsers and the limits.                                                                                        |
| `session.ts`  | `Session`: a `Channel` turned into an authenticated, encrypted frame pipe.                                                               |
| `engine.ts`   | `SyncEngine`: cursors, batches, applying changes, keeping every connection level.                                                        |
| `channel.ts`  | The `Channel` interface, and an in-memory pair for tests.                                                                                |
| `store.ts`    | The `SyncStore` interface an app implements.                                                                                             |
| `testing/`    | An in-memory store and a simulated network, shared by the tests and by apps' own tests.                                                  |

An app gives the engine a `SyncStore` and, for each connection, a `Channel`.
On the Mac the store is SQLite (`apps/desktop/backend/sync/sync-store.ts`) and
the channel is a WebSocket (`lan-transport.ts`, next to it).

## What is synced: `ItemRecord`

Text items only. Images, files and colors never leave the device.

| Field        | Meaning                                                | On merge                                                                                          |
| ------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `id`         | 1 to 64 of `A-Za-z0-9_-`                               | never changes                                                                                     |
| `kind`       | always `"text"`                                        | never changes                                                                                     |
| `text`       | the copied text; `null` in a tombstone                 | dropped when the item is deleted                                                                  |
| `createdAt`  | ms since epoch, when it was first copied               | never changes                                                                                     |
| `origin`     | id of the device that first copied it                  | never changes                                                                                     |
| `dateCopied` | ms since epoch, the latest copy                        | the larger wins, and brings its `sourceApp`; on a tie the larger `sourceApp` (`null` is smallest) |
| `sourceApp`  | the app it was copied from, or `null`                  | follows `dateCopied`                                                                              |
| `pinned`     | `{ at, stamp }` or `null`; `at` is `null` for an unpin | the larger `stamp` wins                                                                           |
| `deletedAt`  | ms since epoch, or `null`                              | once set it stays set; the earliest wins                                                          |

Every field only ever moves one way, so `mergeRecords` is commutative,
associative and idempotent: devices that exchange everything end up identical,
in any order, however often a change is repeated. A deleted item keeps only its
pin stamp (`at` becomes `null`), so two devices holding one stamp cannot
disagree about when it was pinned.

A `stamp` is a hybrid logical clock value written as
`<12 hex digits of ms>-<4 hex digits of counter>-<device id>`. Plain string
comparison orders stamps, and the device id means two devices never tie. A
device that has seen a stamp makes only larger ones afterwards.

A record from a peer is untrusted input. `parseRecord` checks every field's type
and range and drops unknown fields. A text is at most 1 MB of UTF-8
(`maxTextBytes`); a tombstone carries no text.

Devices drop the history they trim for their own limit without a tombstone: that
is local, and the limit is per device. A user's delete does leave one.

## Keys, the recovery code and the pairing link

- **Vault key**: 32 random bytes, shared by all of one user's devices. An app
  keeps it in its secure store (the Keychain on the Mac).
- From it, HKDF-SHA256 with the salt `teneo-sync` and the labels `authKey`,
  `dataKey` and `tag` gives the handshake key (32 bytes), a key for data at rest
  in a relay (32 bytes, unused until there is one) and the discovery tag
  (8 bytes, hex). The tag lets devices find each other on the network without
  naming the vault: they announce it and ignore services with another one.
- **Recovery code**: the vault key in Crockford base32 followed by 4 characters
  of checksum (the start of the base32 of the key's SHA-256), in groups of four
  joined with `-`: 14 groups. Decoding ignores case, spaces and dashes, reads
  `O` as `0` and `I` or `L` as `1`, and refuses a code whose checksum is wrong.
- **Pairing link**, the text of the QR code:
  `teneo://pair?v=1&k=<vault key in base32>&a=<host:port,host:port,...>`.
  `a` lists the addresses the showing device listens on and may be empty.

Whoever has the key can read the history. Neither the key nor the recovery code
is ever logged.

## The connection protocol (version 1)

A `Channel` is an ordered, reliable pipe of string messages (a WebSocket on the
Mac). Either device may open it; both listen when they can. The side that
opened it is the _initiator_, the other the _responder_.

### Handshake

Both sides send, as JSON text:

1. `{ "t": "hello", "v": 1, "deviceId": <32 hex>, "nonce": <16 random bytes, hex> }`
   A different `v` closes the connection with the reason `version`, which the
   app shows as "update Teneo on the other device". Connecting to your own id
   closes it too.
2. `{ "t": "proof", "mac": <hex> }` where
   `mac = HMAC-SHA256(authKey, role + "|" + transcript)`, `role` is
   `initiator` or `responder` (each side proves its own role, and checks the
   other's), and
   `transcript = initiatorNonce|responderNonce|initiatorId|responderId`.
   A wrong proof closes it with the reason `auth`: the other device does not
   hold the vault key. Proofs are compared in constant time.

The whole handshake must finish within 10 seconds.

### Frames

After the proofs every message is the base64 of an AES-256-GCM ciphertext
(with its 16-byte tag) of one JSON frame. Each direction has its own key:

```
key = HKDF-SHA256(authKey, salt "teneo-sync",
                  info "session initiator to responder|" + transcript)   // initiator -> responder
      HKDF-SHA256(authKey, salt "teneo-sync",
                  info "session responder to initiator|" + transcript)   // responder -> initiator
```

The GCM nonce is the frame's number in its direction: 12 bytes, the first 4
zero, then the number as a 64-bit big-endian integer, starting at 0. A frame
that is repeated, dropped, reordered or altered fails to decrypt, and the
connection closes with the reason `protocol`. A message over 8 MiB is refused
before it is decrypted.

| Frame          | Fields                                                | Meaning                                                                                                                                                            |
| -------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `state`        | `epoch`, `name`, `platform`, `cursor: { epoch, seq }` | Sent once, first. Who this is (name at most 128 characters, platform at most 32, such as `mac`, `android`, `ios`) and how far it has read the other's changes.     |
| `changes`      | `epoch`, `items`, `upTo`, `more`                      | A batch of records, at most 200 and about 256 KB. `upTo` is the sender's `syncSeq` that everything up to has been sent; `more` says another batch follows at once. |
| `ping`, `pong` | none                                                  | Every 15 seconds. A connection silent for 45 seconds closes with `timeout`.                                                                                        |

Some things came after the first release, without a new version:

- `state` may also carry `maker` (who made the device, such as `google`, at
  most 64 characters) and `caps` (a list of what the sender understands beyond
  the first release). An older Teneo drops both; a malformed one is left out,
  never a reason to refuse the device.
- A device that lists the capability `app-icons` answers `icons-want`
  (`names`: at most 32 app names) with `icons` (`icons`: `{ name, png }`, the
  png in base64 and at most 64 KB), leaving out the apps it has no icon for.
  An older Teneo closes over a frame it doesn't know, so these two are only
  ever sent to a device that listed the capability. A Mac lists it; a phone
  asks for the icon of each app in the records it receives, once per app.

- A device that lists the capability `images` takes image records (`kind:
  "image"`, `text: null`, and `image: { hash, bytes, width, height, type }`:
  the SHA-256 of the file, its length, at most 16 MiB, and one of png, jpeg,
  gif and webp) and exchanges their bytes: `blob-want` (`hash`) is answered
  with `blob` frames (`hash`, `offset`, `total`, `data`: at most 192 KiB in
  base64, in order from offset 0) or with `blob-none` (`hash`) when the
  device holds no such file. A device asks for one image at a time, and
  again on its next connection for any it still lacks. Image records and
  these frames are only sent to a device that listed the capability.

- The user can disconnect one device on another, and the rest of the vault
  carries on. Every device holds the same key, so this is an agreement
  between two apps, not a lock: it keeps a Teneo away, not someone who took
  the key out of one. The device that was told to (`removals` in the engine's
  options) takes no records from the other and sends it none. To one that
  lists the capability `removal` it sends `removed` (no fields) and waits two
  seconds for it to close; one that doesn't list it is only closed. The
  device that reads `removed` stops dialing the other.

  Pairing again undoes it. `state` may carry `pairing`, an id (at most 64
  characters) a device makes anew each time it is paired: when sync is turned
  on, or a code is joined. The device that disconnected another keeps the
  pairing it had then, and takes it back when it comes with a different one.
  A device paired before there was such an id sends none, and stays
  disconnected until it is paired again and sends one.

A colour has no kind of its own on the wire: it travels as the text it was
copied as, and each device finds the colour in it again.

A device that closes for a protocol reason says which one (`auth`, `version`,
`protocol`, `timeout`) as the close reason, so both sides show the same cause.

If two devices connect to each other at once, both keep the connection opened
by the device with the smaller id, so they never keep different ones.

## How changes flow

- Every device numbers its own writes: each write to a synced row, whether the
  user made it or it was applied from a peer, stamps the row with the next
  `syncSeq`. A store also has a random `epoch`, made with its database.
- For each peer a device remembers the peer's epoch and how far it has read
  (`receivedSeq`). It sends that as the cursor in `state`. The peer answers with
  every eligible row above it, in batches, and then sends new changes as they
  happen. A cursor whose epoch is not the peer's current one is ignored, and
  sending starts from 0.
- A batch is applied, and the cursor saved, in one transaction. After a crash
  the next connection resumes at the last batch that was applied whole.
- A row applied from a peer gets a new `syncSeq` of its own, so it travels on to
  other peers (a phone gets one Mac's items from another). A merge that changes
  nothing writes nothing, and that is what ends the echo.
- Eligible to send: text at most 1 MB, and, for an item holding a detected
  secret, only while `syncSecrets` says true. A tombstone is always sent.
  `localChanged()` tells the engine the history or that setting changed.
- After a batch changed anything, the device runs its own history trim.
- **The same text on two devices is one item.** When a new item arrives that
  is a plain copy (not a delete, not pinned) and the newest unpinned local item
  has the same text, the one with the smaller id stays, takes the later copy
  time and its source app, and the other becomes a tombstone. Both results are
  ordinary changes, so every device reaches the same state.

## What an app provides

- `Channel` (`channel.ts`): `send`, `onMessage`, `onClose`, `close`, and whether
  this side is the initiator. The transport owns discovery, listening, dialing
  and reconnecting; the engine only gets connections through `attach(channel)`.
- `SyncStore` (`store.ts`): `epoch`, `changesAfter(after, limit)` (rows above a
  `syncSeq`, with the store's highest one, from one snapshot), `getPeer`,
  `latestStamp`, `trimHistory` and `transaction`, whose `put` stamps the row and
  runs the app's own secret and link detection on the text. The merge rules and
  the cursor logic stay in the engine, so they are written once.
- Optionally `images` (`ImageStore`: which hashes it lacks, a piece of a file
  it holds, and a place for a piece that arrives, which it checks against
  the hash once whole). Without it a device neither sends nor takes images.
- Optionally `iconSource` (a Mac: the png of an app by its name) or `iconSink`
  (a phone: which names it lacks, and a place to keep one), and `maker`.

The Mac transport is in `apps/desktop/backend/sync/`: it listens with
`tjs.serve` on the first free of ports 47823 to 47827 and finds other devices
with macOS's `dns-sd` (the service `_teneo-sync._tcp`, with the TXT records
`vt=<tag>` and `dev=<device id>`). The root README tells how to run the dev peer
and the two-peer check.

## Tests

`bun test` in this folder (or `bun run test` from the repo root, through Turbo):

- `record.test.ts`: `merge` properties on random inputs, validation.
- `crypto.test.ts`, `hlc.test.ts`: encodings, recovery codes, stamps.
- `session.test.ts`: the handshake, a wrong key, a replayed, altered or
  reordered frame, a version mismatch, silence.
- `engine.test.ts`: three devices over simulated channels with random copies,
  pins, deletes, disconnects and reconnects converge; epoch resets; batching
  boundaries; the secrets filter; the same-text rule; relay through a middle
  device.

`testing/` holds the in-memory `SyncStore` and the simulated network those
tests use.

## Changing the protocol

Version 1 is meant to be frozen when sync ships, and an older Teneo cannot be
updated at the same moment as a newer one. So:

- Do not change what an existing field means, or the key derivation, or the
  handshake. Add fields only where the parsers already ignore unknown ones
  (`parseRecord` drops unknown record fields; frames and handshake messages are
  parsed by their `t`).
- A new kind of frame that a device can do without goes behind a capability:
  name it in `capabilities`, list it in `state`'s `caps`, and send the frame
  only to a device that listed it. App icons work this way.
- Anything older devices cannot understand needs a new `protocolVersion`, so
  they fail with a clear message instead of a protocol error.
- Keep new code free of `tjs`, Node and DOM APIs, and run `bun test` here.
