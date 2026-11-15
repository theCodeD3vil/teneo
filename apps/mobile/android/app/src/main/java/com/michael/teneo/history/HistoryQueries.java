package com.michael.teneo.history;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The SQL of the history list and of the history limits, with no database in
 * here so JUnit can test it. Ports of the Mac's history-query.ts and
 * database.ts, kept to what SQLite 3.22 (Android 10) understands.
 */
public final class HistoryQueries {

    public static final long DAY_MS = 24L * 60 * 60 * 1000;
    /** Tombstones stay this long, so a device that was off meanwhile still hears of the delete */
    public static final long TOMBSTONE_LIFETIME_MS = 30 * DAY_MS;

    /** Pinned items first, newest pin first, then newest copy first. The id
     *  breaks ties so paging never skips or repeats an item. */
    public static final String LIST_ORDER = "pinnedAt IS NULL, pinnedAt DESC, dateCopied DESC, id DESC";
    /** LIST_ORDER past the pinned items, where pinnedAt is always NULL: it reads
     *  the page straight off the unpinned index instead of sorting */
    public static final String UNPINNED_ORDER = "dateCopied DESC, id DESC";

    /** A deleted text: it holds no text, only news for the other devices */
    public static final String TOMBSTONE_ROW =
        "(deletedAt IS NOT NULL AND ((kind = 'text' AND value IS NULL) OR (kind = 'image' AND path IS NULL)))";

    /** An image sync has heard of whose file has not arrived yet: not shown until it has */
    public static final String WAITING_IMAGE = "(kind = 'image' AND path IS NULL)";
    private static final String YOUNG_TOMBSTONE = "(" + TOMBSTONE_ROW + " AND deletedAt >= ?)";

    /**
     * Unpinned items copied before the second value, or beyond the newest N
     * unpinned ones (the fourth, -1 for no limit). Pinned items are never
     * deleted or counted, and neither are young tombstones. Fill the four with
     * deletionValues.
     */
    public static final String DELETION_CONDITION =
        "pinnedAt IS NULL AND NOT " +
        YOUNG_TOMBSTONE +
        " AND (dateCopied < ? OR id NOT IN (" +
        "SELECT id FROM CLIPBOARD_ITEMS WHERE pinnedAt IS NULL AND NOT " +
        YOUNG_TOMBSTONE +
        " ORDER BY dateCopied DESC, id DESC LIMIT ?))";

    private HistoryQueries() {}

    /** Where a page ends: the sort keys of its last item */
    public static final class ListCursor {

        public final Long pinnedAt;
        public final long dateCopied;
        public final String id;

        public ListCursor(Long pinnedAt, long dateCopied, String id) {
            this.pinnedAt = pinnedAt;
            this.dateCopied = dateCopied;
            this.id = id;
        }
    }

    /** SQL to put in a WHERE, and the values for its placeholders, in order */
    public static final class Condition {

        public final String sql;
        public final List<Object> values;

        Condition(String sql, List<Object> values) {
            this.sql = sql;
            this.values = values;
        }
    }

    /** The ORDER BY of the page after `cursor` (the first page has none) */
    public static String pageOrder(ListCursor cursor) {
        return cursor != null && cursor.pinnedAt == null ? UNPINNED_ORDER : LIST_ORDER;
    }

    /** The rows after `cursor` in LIST_ORDER. Row values, so sqlite seeks the index. */
    public static Condition afterCursor(ListCursor cursor) {
        if (cursor.pinnedAt == null) {
            return new Condition("(pinnedAt IS NULL AND (dateCopied, id) < (?, ?))", Arrays.asList(cursor.dateCopied, cursor.id));
        }
        // a NULL pinnedAt makes the row value NULL, so unpinned rows are kept apart
        return new Condition(
            "(pinnedAt IS NULL OR (pinnedAt, dateCopied, id) < (?, ?, ?))",
            Arrays.asList(cursor.pinnedAt, cursor.dateCopied, cursor.id)
        );
    }

    /**
     * The WHERE of a list request; `search` is trimmed and lower-cased. A row
     * holding secrets passes on any search that sqlite can't rule out, and is
     * checked again row by row (HistoryText.matchesSearch): a secret's text
     * may be hidden, and the secrets column is JSON.
     */
    public static Condition listConditions(String kind, String search, ListCursor cursor) {
        List<String> conditions = new ArrayList<>();
        List<Object> values = new ArrayList<>();
        conditions.add("deletedAt IS NULL");
        conditions.add("NOT " + WAITING_IMAGE);
        // a text that is a colour is listed with the colours, not the texts
        if ("color".equals(kind)) {
            conditions.add("color IS NOT NULL");
        } else if ("text".equals(kind)) {
            conditions.add("kind = 'text' AND color IS NULL");
        } else if (!"all".equals(kind)) {
            conditions.add("kind = ?");
            values.add(kind);
        }
        if (!search.isEmpty()) {
            String pattern = HistoryText.likePattern(search);
            conditions.add(
                "(value LIKE ? ESCAPE '\\' OR sourceAppName LIKE ? ESCAPE '\\' OR linkHost LIKE ? ESCAPE '\\' OR secrets LIKE ? ESCAPE '\\')"
            );
            values.addAll(Arrays.asList(pattern, pattern, pattern, pattern));
        }
        if (cursor != null) {
            Condition after = afterCursor(cursor);
            conditions.add(after.sql);
            values.addAll(after.values);
        }
        return new Condition(String.join(" AND ", conditions), values);
    }

    /** "Keep history for": items copied before this are deleted; 0 keeps them all */
    public static long copiedBefore(long now, long retentionDays) {
        return retentionDays > 0 ? now - retentionDays * DAY_MS : 0;
    }

    /** "Maximum items" as the newest-N of DELETION_CONDITION: -1 for no limit */
    public static long keepNewest(long maxItems) {
        return maxItems > 0 ? maxItems : -1;
    }

    /** Whether these limits can delete anything. With none set, checking
     *  would still read the whole history for its NOT IN. */
    public static boolean limitsHistory(long copiedBefore, long keepNewest) {
        return copiedBefore > 0 || keepNewest >= 0;
    }

    public static Object[] deletionValues(long now, long copiedBefore, long keepNewest) {
        long cutoff = now - TOMBSTONE_LIFETIME_MS;
        return new Object[] { cutoff, copiedBefore, cutoff, keepNewest };
    }
}
