# Memory optimization walkthrough

Commit `193a55a` on `development`, 13 November 2026.

This document explains what the panel did before, what it does now, where
the pieces live, and what to check by hand. It follows the item from the
database to the card on screen.

## The problem

With a long history the panel's page process grew past a gigabyte. Four
things added up:

1. **Every clipboard change re-read the whole history.** The backend
   selected every row, decrypted every encrypted one, ran the secret and
   link regexes over every text, and sent the lot over IPC. One text in a
   real history was 963,000 characters long. It went across on every
   refresh.
2. **Every item had a mounted card.** The list rendered all items at once,
   so a history of 1,000 items meant 1,000 card components and their DOM.
3. **Every card listened for key presses.** Each card registered its own
   window keydown listener for ⌘1 to ⌘9. A key press ran through all of
   them.
4. **Caches never shrank.** App icons were cached forever, and previews for
   every card that ever rendered stayed in the query cache.

Measured on the installed 0.3.4 after two days of use, against the new
code in dev mode after one scroll through the history:

| Process              | Installed 0.3.4 | New code (dev build) |
| -------------------- | --------------- | -------------------- |
| Page process at rest | 519 MB          | 203 MB               |
| Page process peak    | 1036 MB         | 518 MB               |
| Backend at rest      | 143 MB          | 32 MB                |

The dev build still carries Vite's client and source maps, so a production
build should land lower on the page side.

## The flow now

```
SQLite ──page of 50 rows──▶ listClipboardItems ──{items,nextCursor,total}──▶ IPC
   │                              │
   │                              └─ decrypts and checks only those rows
   │
   └──one row──▶ getClipboardItem ──whole item──▶ IPC (preview, copy, paste)

Page: useClipboardList (infinite query, keyed by tab + search)
        └─▶ TabManager ─▶ AllTabContent (virtualizer: ~15 rows mounted)
                              └─▶ useItemPreviews(visible rows only)
```

## Backend

### `backend/history-query.ts` (new)

Pure helpers with no SQLite import, so `bun test backend` covers them in
`history-query.test.ts`.

- `listOrder` is the sort: pinned first, newest pin first, newest copy
  first, then id. The id tie-break is what makes paging exact.
- `afterCursor(cursor)` turns the last item of a page into a WHERE clause
  that selects everything after it in that order. This is keyset paging. A
  copy that arrives between two page loads cannot cause a skipped or
  repeated item, which offset paging would.
- `likePattern(search)` builds a `%…%` pattern with `%`, `_` and `\`
  escaped.
- `matchesSearch(item, search, maskSecrets)` is the row-by-row check. It
  mirrors the rule the frontend used to enforce: a masked key is found by
  its kind label and its last four characters, never by its body.
- `truncateTextPreview(text, secrets, fullLength, limit)` cuts a long text
  for the list. If the cut would land inside a secret, the cut moves to the
  start of that secret, so a secret is either shown whole and masked or
  not shown at all.
- `parseListRequest(parameters)` validates what the page sends and falls
  back to the first page of everything.

### `backend/database.ts`

**New columns** on `CLIPBOARD_ITEMS`, added on open through the existing
`addMissingColumns`: `secrets` (JSON array or NULL), `linkUrl`, `linkHost`,
`detectorVersion`.

**Saving** computes secrets and link once and stores them. The regexes no
longer run on list.

**`refreshDetectionMetadata`** runs at startup, not awaited. It re-scans
every text whose `detectorVersion` is NULL or older than the constant
`detectionVersion` at the top of the file. On first launch after this
change that is every existing text, once. Encrypted texts that cannot be
decrypted right then are left for the next start.

> When you change a rule in `findSecrets` or `findLink`, bump
> `detectionVersion`. Nothing else is needed for older copies to catch up.

**`listClipboardItems(app, request)`** returns one page:

- `listColumns` selects `substr(value, 1, 1000)` for plain texts and the
  whole value for encrypted texts and texts with secrets. The row-by-row
  search check needs the whole text for those, and the preview cut needs
  to know where the secrets are.
- `listConditions` builds the WHERE from kind, search and cursor. For a
  search, SQLite matches `value`, `path`, `sourceAppName` and the stored
  `secrets` JSON (which carries the labels). Encrypted rows always pass
  SQLite and are decided in JavaScript.
- The fetch loop asks for a page's worth of rows, decrypts each, applies
  `matchesSearch` only where SQLite could not decide (`needsSearchCheck`),
  and keeps going from the last examined row until the page is full or the
  rows run out. This is also how undecryptable rows drop out without
  leaving a short page.
- `nextCursor` is null once the rows ran out, otherwise the sort keys of
  the last row examined.
- `total` comes from `countClipboardItems`: a plain COUNT without a search;
  with one, a COUNT of rows SQLite can decide plus a JavaScript pass over
  the few it cannot.

**`getClipboardItem(id, app)`** returns one item whole, or null once it is
deleted.

**`rowToClipboardItem(row, dataDirectory, preview)`** now reads secrets and
link from the columns, and with `preview` true applies the text cut and
sets `isTruncated`.

A detail that bit during verification: the `encrypted` column is NULL on
plain rows, and in SQLite `NOT (NULL = 1)` is NULL, which drops the row.
The conditions use `encrypted IS 1` for that reason.

### `backend/main.ts`

- `clipboardItems` takes the request object and returns a page.
- `clipboardItem` takes `{ id }` and returns the whole item or null.
- `init` kicks off `refreshDetectionMetadata` after the encryption sweep.

### `shared/types/clipboard.ts`

`ClipboardHistoryItem` gains `isTruncated`. New types `ClipboardListRequest`,
`ClipboardListCursor` and `ClipboardListPage`, and the constant
`textPreviewLength = 1000`.

## Frontend

### `src/composables/useClipboard.ts` (rewritten)

- `useClipboardList(filter)` wraps an infinite query keyed by
  `["clipboard-items", kind, search]`. It exposes `items` (pages flattened
  and deduplicated by id), `total`, `hasMore`, `loadingMore` and
  `loadMore`. When a search narrows, the previous results stay up as
  placeholder data; a tab switch does not reuse the previous tab's list.
- `useClipboardItem(id, placeholder)` fetches one item whole for the
  preview. The list's copy is shown as placeholder data so the preview
  opens at once, then the full text replaces it. `isGone` turns true when
  the backend returns null, which closes the preview.
- One shared subscription to the backend's history-changed event
  invalidates both query families. Active lists refetch their loaded pages;
  inactive ones refetch when shown again.
- `fetchClipboardItem(id)` is the plain fetch used by copy and paste.

### `src/components/AllTabContent.vue` (rewritten)

- Rows are headers and items in one flat list, as before, but now fed to
  `useVirtualizer` from `@tanstack/vue-virtual`, the same pattern as
  `TextPreview.vue`. The scroll element is the ScrollArea viewport.
- Each mounted row is absolutely positioned and carries the gap above it as
  padding, so measured heights include spacing. Estimates: header 16 px,
  card 60 px, plus the gap.
- `visibleRows` pairs each virtual row with its data so the template can
  narrow on `row.type`. The pre-commit type-check requires this.
- `useItemPreviews` receives only the visible items, so previews, app icons
  and link icons load for cards on screen and nothing else.
- Selection: a watch on `activeItemId` calls `scrollToIndex`. If the row
  above is a group header it scrolls to the header, so "Today" stays
  visible when you move to the first item.
- Paging: a watch on the virtual rows emits `load-more` when the last
  mounted row is within 10 rows of the end and more exist.
- The list scrolls to the top on the panel reset event.
- Key actions (`copyActiveItem`, `pasteActiveItem`, `deleteActiveItem`,
  `pinActiveItem`, `copyItemByNumber`) find the item by id in the loaded
  list and act directly. They no longer go through card refs, because the
  card for an item may not be mounted. The old card-ref map is gone.

The pin slide animation that `TransitionGroup` provided is gone. A
virtualizer owns the row positions, so there is no cheap way to animate a
card moving between groups.

### `src/components/ClipboardItemCard.vue`

Reduced to what a click does: copy on single click, preview on double
click, the pin and delete buttons. It no longer registers hotkeys, no
longer scrolls itself into view, and no longer exposes methods. Copying
goes through the shared helper below.

### `src/components/TabManager.vue`

- Uses `useClipboardList` with `{ kind: selectedTab, search: debouncedQuery }`.
  The per-tab filtering and the in-memory search are deleted; the backend
  does both.
- Registers `copyItemByNumber` alongside the other list hotkeys. That puts
  ⌘1 to ⌘9 under the same "not while the preview is open" guard as Enter
  and the arrows. The per-card listeners had no such guard.
- Emits the backend `total` for the footer count, not the loaded length.

### `src/App.vue`

- The preview is driven by `useClipboardItem`, seeded with the list item
  that was double-clicked or had Space pressed on it.
- Calls `notifyPanelVisibility` wherever the panel hides or shows.
- Mounts `usePanelIdleCleanup`.

### `src/utils/copy-item.ts` (new)

`copyItemToClipboard(item, { hideWindow, paste })` fetches the item whole
when `isTruncated` is set, writes it to the clipboard, shows the footer
notice, hides the panel, pastes, and resets the panel, in that order. The
card, Enter, ⌘1 to ⌘9 and paste-on-Enter all use it.

### `src/utils/panel-reset.ts`

Adds a `panelVisibilityEvent` and `notifyPanelVisibility(visible)`. The
`hidePanel` helper fires it too.

### `src/composables/usePanelIdleCleanup.ts` (new)

On hide: trims every list query to its first page (the panel resets to the
top anyway) and removes inactive list queries, which are the lists for
other tabs and searches. Two minutes later, if still hidden: removes every
inactive query, which drops previews and icons nothing on screen uses.

Note that WebKit does not return freed heap to the OS right away. In
measurement the page process did not shrink after the cleanup fired. The
cleanup bounds what the next scroll adds on top, rather than lowering the
resting number.

### `src/composables/useItemPreviews.ts`

App icon cache lifetime dropped from forever to five minutes. It also only
receives visible items now, from the list.

## Behaviour changes to know about

- **Search is ASCII case-insensitive in SQLite.** The old in-memory search
  used `toLowerCase`, which is Unicode-aware. A query like `É` will no
  longer match `é`. Everything else about search is the same, including
  the masked-key rule.
- **The footer count counts rows, not decryptable rows.** If the Keychain
  is denied, encrypted items drop out of the list but still count.
- **No pin slide animation.** See above.
- **First launch after the update scans every text once** for secrets and
  links in the background. On a history with a very long text this can
  take a few seconds of backend time, once.
- **A history change while scrolled deep refetches every loaded page** in
  sequence. On hide the pages are trimmed to one, so this only matters
  while the panel is open.

## Manual checks

- Open the panel and press ↓ repeatedly. The selection should scroll with
  you, and "Today" should come back into view when you press ↑ to the first
  item.
- Scroll past 50 items. The next page should append without a visible seam
  and without the scroll position jumping.
- Scroll far down, then press ⌘1. It should copy and paste the first item
  even though its card is not on screen.
- Press Space on a long text. The preview should open at once with the
  first part, then show the whole text.
- Enter on a long text should paste the whole text, not the first 1000
  characters.
- Search while on the Text tab, then switch to Files. Each tab should show
  its own matches and the footer count should match.
- With "Mask API keys" on, search for part of a key's body. It should not be
  found. Search for the key's kind, such as `github`, and it should be.
- Press P on an item in the middle of the list. It should move to Pinned
  and the selection should stay on its neighbour.
- Press D on the selected item. The selection should move to the neighbour.
- Hide the panel and reopen it. It should be on All, at the top, with the
  first item selected.

## Possible follow-ups

- A production build of the new code, measured against the installed one
  with the same history, for a like-for-like page number.
- Shorter preview cache lifetime, or a cap on cached thumbnails, to lower
  the scrolling peak.
- ~~An index on `(pinnedAt, dateCopied DESC, id DESC)` if a history grows into
  the tens of thousands.~~ Done, see below.

## Round two: indexes, WAL and repeat copies

A review of the follow-up plan (WAL, indexes, duplicate suppression, query
invalidation, statement reuse) against generated 5,000 and 100,000 row
histories. What went in, what changed from the plan, and what was dropped.

### Indexes (`backend/database.ts`, `backend/history-query.ts`)

The plan's index, `(pinnedAt DESC, dateCopied DESC, id DESC) WHERE deletedAt
IS NULL`, does not remove the sort: the list's ORDER BY starts with the
expression `pinnedAt IS NULL`, which a column index cannot serve. Four
indexes replace the old `clipboard_items_date_copied_index`:

| Index                                                                                                                         | Serves                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `clipboard_items_list_order_index` on `((pinnedAt IS NULL), pinnedAt DESC, dateCopied DESC, id DESC) WHERE deletedAt IS NULL` | the first page, pages still among pinned items                                               |
| `clipboard_items_kind_list_order_index`, the same led by `kind`                                                               | those pages on the Text, Images, Files, Colors tabs                                          |
| `clipboard_items_unpinned_index` on `(dateCopied DESC, id DESC) WHERE pinnedAt IS NULL`                                       | pages past the pinned items, the repeat-copy check, the newest-N subquery of "Maximum items" |
| `clipboard_items_kind_unpinned_index`, the same led by `kind`                                                                 | those pages per tab                                                                          |

Two query changes were needed for the cursor pages to use them:

- `afterCursor` compares row values, `(dateCopied, id) < (?, ?)` and
  `(pinnedAt, dateCopied, id) < (?, ?, ?)`, instead of a chain of ORs.
  SQLite seeks an index to a row value but not to the OR form.
- `pageOrder(cursor)` drops the two leading ORDER BY terms once the cursor
  is past the pinned items. The WHERE fixes `pinnedAt` to NULL there, so
  the terms are constant, but the planner cannot see that and sorts.

Measured on 100,000 rows with the sqlite CLI (per query, warm):

| Query                             | Before      | After   |
| --------------------------------- | ----------- | ------- |
| first page                        | 29 ms       | 0.2 ms  |
| first page, one tab               | 14 ms       | 0.2 ms  |
| page deep in the scroll           | 25 to 60 ms | 0.15 ms |
| footer count                      | 11 ms       | 4 ms    |
| "Maximum items" newest-N subquery | 50 to 70 ms | 0.3 ms  |

Dropping the old `dateCopied` index matters as much as adding the new
ones: while it exists the planner picks it for a deep page and sorts the
result. The old index is dropped on the next start (`DROP INDEX IF
EXISTS`), and the new ones are created with `IF NOT EXISTS`, so the
migration is idempotent and reversible.

### Trim after every copy (`deleteClipboardItems`)

The newest-N subquery deliberately keeps `WHERE pinnedAt IS NULL` without
`deletedAt IS NULL`: soft-deleted rows still count toward "Maximum items"
(decided with the soft-delete work; excluding them would purge every
deleted item at once). The unpinned index matches that query as written.
The one new shortcut is `limitsHistory`: with no limit set, the default,
`deleteClipboardItems` and `countClipboardItemsToDelete` return at once
instead of running a NOT IN over the whole history for nothing.

### WAL (`openDatabase`)

`journal_mode = WAL`, `synchronous = NORMAL`, `busy_timeout = 5000`, via
`Database.exec`. WAL is stored in the file, so it stays on after a
downgrade; `PRAGMA journal_mode = DELETE` turns it back. The backend is one
process, so the win is cheaper saves (no fsync per copy), not concurrency.

### Repeat copies (`findRepeatCopy`, `backend/duplicate-copy.ts`)

Copying the same text, color or file list as the newest unpinned item
bumps that item (`dateCopied`, source app) instead of adding a row. The
comparison is against the newest unpinned row by `dateCopied`, not the
list's head, which is a pinned item whenever one exists; a pinned item is
never bumped. Images are never treated as repeats: the picture is already
saved under a new name when `saveClipboardItem` runs, and telling two
screenshots apart would need a content hash column. An encrypted text that
cannot be decrypted right now is not a repeat and is saved anew.

### Dropped from the plan

- **Query invalidation.** The plan named `refetchPage`, which TanStack
  Query v5 removed; infinite queries refetch every loaded page on
  invalidation by design. The v5 answer is `maxPages`, but dropping pages
  from the top shifts every virtualizer index and needs
  `fetchPreviousPage` plus scroll anchoring in `AllTabContent.vue`. With
  the indexes a page costs 0.2 ms, so the refetch cascade is now IPC-bound
  and tolerable. Left as a UI follow-up.
- **Prepared statement reuse.** Microseconds per call against an IPC round
  trip, with statement lifetimes to manage. Not worth it.

### Manual checks

- First start after the update: `sqlite3 <data>/teneo.sqlite "PRAGMA
  journal_mode;"` prints `wal`, and `-wal` and `-shm` files appear beside
  the database.
- Copy the same text three times. One card, at the top, with the time of
  the last copy. Copy it from another app: the card shows that app.
- Pin an item, copy its text again. The pinned card stays put and a new
  card appears at the top of the unpinned items.
- Scroll past the pinned items and keep going. Pages append with no seam,
  no repeated and no missing items.
