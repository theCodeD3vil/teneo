# Teneo history encryption: plan

Encrypt the whole clipboard history on the Mac, not only the text that holds a
detected secret, so that a copy of the database file gives nothing away.
Written on 2026-11-18, after the trojaned 0.4.2 release showed that malware
running as the user could read the history file directly.

## Where things stand

- With "Encrypt API keys" on, text that holds a detected secret (private keys,
  GitHub/GitLab/AWS/Google/Slack/Stripe/Anthropic/OpenAI/npm tokens, JWTs,
  passwords in URLs) is saved with AES-GCM. The key is 32 random bytes kept in
  the macOS Keychain (`backend/secret-encryption.ts`). The setting is off by
  default (`packages/shared/src/types/settings.ts`), except for people who
  upgrade from a version that always encrypted.
- Everything else is plain text in `teneo.sqlite`: ordinary text, links,
  colours, file paths, source app names. Images are plain files in the data
  folder, passed to the window by path.
- Search already copes with encrypted rows: `listConditions` lets
  `encrypted IS 1` rows past sqlite and `needsSearchCheck`/`matchesSearch`
  check them in JavaScript after `decryptRow`. The count decrypts every
  encrypted row as well.
- Sync is end-to-end encrypted already (`packages/sync/src/session.ts`), and
  `sync-store.ts` decrypts going out and encrypts coming in for secrets.
- Android keeps its history in plain sqlite inside the app's private storage,
  with backups off. Only the vault key sits in the Android Keystore.

## What this protects against, and what it doesn't

Protects against: malware that copies files (as the 0.4.2 backdoor could),
Time Machine and other backups, anyone holding the disk. They get ciphertext;
the key stays in the Keychain, which hands it only to Teneo's signed app and
shows a prompt to anything else.

Does not protect against: malware reading the live clipboard (any app can),
screenshots, the user approving a Keychain prompt, or a trojaned Teneo signed
with the real signing identity.

## Measured cost

On `~/.tinyjs/bin/tjs`, 10,000 synthetic items (4.3 MB of text, most items
120-360 characters, every 20th 4 KB):

| Operation                             | Time   |
| ------------------------------------- | ------ |
| sqlite `LIKE` search over all (today) | 4 ms   |
| Decrypt all and search                | 157 ms |
| Decrypt one 50-item page              | ~1 ms  |
| Encrypt all (one-off migration)       | 127 ms |
| HMAC of all (duplicate detection)     | 145 ms |

Parallel decryption is no faster than sequential (157 ms both): WebCrypto runs
one call at a time on this runtime. Real histories seen so far hold 10 to 150
items, about 1% of this test.

## Design: per-row encryption and an in-memory search index

1. Encrypt the content columns (`value`, `path`, `secrets`, `linkUrl`,
   `linkHost`) with the key `secret-encryption.ts` already keeps. Leave `id`,
   `kind`, `dateCopied`, `pinnedAt`, `deletedAt` and the sync columns plain so
   ordering, paging and sync stay in SQL. Visible to a file reader: when
   something was copied, its kind and its size.
2. Search: drop `LIKE`. Decrypt everything once (at launch or on the first
   search) into an in-memory index of lower-cased text; each search after that
   takes milliseconds. The count reads the same index. Memory cost is about
   the size of the history's text.
3. Duplicate detection (`findRepeatCopy`): AES-GCM with random IVs makes
   `WHERE value = ?` useless. Add a `valueHash` column holding an HMAC of the
   text under a key derived from the history key. It reveals only that the
   same text was copied twice.
4. Previews: the list cuts previews out of `value` in SQL today
   (`textPreviewLength`). Encrypted text is fetched whole, decrypted, then
   cut. Cheap per page; long pastes cost more.
5. Migration: encrypt existing rows the way `encryptSecretsInHistory` does,
   then `PRAGMA wal_checkpoint(TRUNCATE)` and `VACUUM`, and keep
   `PRAGMA secure_delete = ON`. Without this the old plain text stays in
   sqlite's free pages and the WAL.
6. Sync: nothing changes on the wire. `sync-store.ts` decrypts going out and
   encrypts coming in for every item, as it already does for secrets.

## Later phases

- Image files: encrypt at rest and send decrypted bytes to the window instead
  of a path. Costs memory and IPC; needs a thumbnail cache.
- Link preview cache: encrypt it, or key it by HMAC. Today it shows which
  pages were copied.
- Android: an AES key in the Android Keystore (hardware-backed), applied the
  same way in `HistoryStore`. Lower priority: the app sandbox already keeps
  other apps out.

## Risks

- Losing the Keychain item (a new Mac without Keychain migration, a signing
  change in dev builds) makes the history unreadable. Acceptable for a
  clipboard history, but the UI should say so.

## Alternative considered: SQLCipher

Whole-file encryption keeps `LIKE`, counts and duplicate checks as they are and
hides the metadata too. But txiki's bundled sqlite has no SQLCipher, so it
needs a custom TinyJS runtime build, and Android needs `sqlcipher-android`
(a few MB more in the APK). More dependency for a modest gain.

## Order

1. Turn "Encrypt API keys" on by default. One line, covers the most valuable
   text now.
2. Per-row encryption of every text item on the Mac (steps 1 to 6).
3. Image files, the preview cache, Android.
