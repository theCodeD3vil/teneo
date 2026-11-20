package com.michael.teneo.history;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class HistoryQueriesTest {

    @Test
    public void theCursorAfterAPinnedItemKeepsUnpinnedItems() {
        HistoryQueries.Condition after = HistoryQueries.afterCursor(new HistoryQueries.ListCursor(5L, 3, "b"));
        assertEquals("(pinnedAt IS NULL OR (pinnedAt, dateCopied, id) < (?, ?, ?))", after.sql);
        assertEquals(Arrays.asList(5L, 3L, "b"), after.values);
    }

    @Test
    public void theCursorAfterAnUnpinnedItemSkipsThePinnedOnes() {
        HistoryQueries.Condition after = HistoryQueries.afterCursor(new HistoryQueries.ListCursor(null, 3, "b"));
        assertEquals("(pinnedAt IS NULL AND (dateCopied, id) < (?, ?))", after.sql);
        assertEquals(Arrays.asList(3L, "b"), after.values);
    }

    @Test
    public void aPagePastThePinnedItemsDropsTheConstantOrderTerms() {
        assertEquals(HistoryQueries.LIST_ORDER, HistoryQueries.pageOrder(null));
        assertEquals(HistoryQueries.LIST_ORDER, HistoryQueries.pageOrder(new HistoryQueries.ListCursor(5L, 3, "b")));
        assertEquals(HistoryQueries.UNPINNED_ORDER, HistoryQueries.pageOrder(new HistoryQueries.ListCursor(null, 3, "b")));
        assertTrue(HistoryQueries.LIST_ORDER.endsWith(HistoryQueries.UNPINNED_ORDER));
    }

    @Test
    public void aListRequestFiltersDeletedItemsKindSearchAndCursor() {
        // an image whose file has not arrived yet is not listed
        assertEquals("deletedAt IS NULL AND NOT (kind = 'image' AND path IS NULL)", HistoryQueries.listConditions("all", "", null).sql);
        assertEquals(Collections.emptyList(), HistoryQueries.listConditions("all", "", null).values);

        HistoryQueries.Condition where = HistoryQueries.listConditions("text", "a_b", new HistoryQueries.ListCursor(null, 3, "b"));
        // a text that is a colour is with the colours, not the texts
        assertTrue(
            where.sql.startsWith(
                "deletedAt IS NULL AND NOT (kind = 'image' AND path IS NULL) AND kind = 'text' AND color IS NULL AND (value LIKE ? ESCAPE '\\'"
            )
        );
        assertEquals(
            "deletedAt IS NULL AND NOT (kind = 'image' AND path IS NULL) AND color IS NOT NULL",
            HistoryQueries.listConditions("color", "", null).sql
        );
        HistoryQueries.Condition images = HistoryQueries.listConditions("image", "", null);
        assertEquals("deletedAt IS NULL AND NOT (kind = 'image' AND path IS NULL) AND kind = ?", images.sql);
        assertEquals(Collections.singletonList("image"), images.values);
        assertTrue(where.sql.endsWith("AND (pinnedAt IS NULL AND (dateCopied, id) < (?, ?))"));
        assertEquals(Arrays.asList("%a\\_b%", "%a\\_b%", "%a\\_b%", "%a\\_b%", 3L, "b"), where.values);
    }

    @Test
    public void theLimitsCountDaysAndItemsWithZeroForNone() {
        long now = 100 * HistoryQueries.DAY_MS;
        assertEquals(70 * HistoryQueries.DAY_MS, HistoryQueries.copiedBefore(now, 30));
        assertEquals(0, HistoryQueries.copiedBefore(now, 0));
        assertEquals(500, HistoryQueries.keepNewest(500));
        assertEquals(-1, HistoryQueries.keepNewest(0));
        assertFalse(HistoryQueries.limitsHistory(0, -1));
        assertTrue(HistoryQueries.limitsHistory(1, -1));
        assertTrue(HistoryQueries.limitsHistory(0, 0));
    }

    @Test
    public void theDeletionValuesSpareYoungTombstonesTwice() {
        long now = 100 * HistoryQueries.DAY_MS;
        long cutoff = now - HistoryQueries.TOMBSTONE_LIFETIME_MS;
        HistoryQueries.ListCursor lastKept = new HistoryQueries.ListCursor(null, 42L, "m");
        assertArrayEquals(new Object[] { cutoff, 5L, 42L, 42L, "m" }, HistoryQueries.deletionValues(now, 5, 10, lastKept));
        assertEquals(5, HistoryQueries.DELETION_CONDITION.chars().filter((c) -> c == '?').count());
        assertArrayEquals(new Object[] { cutoff, 9L }, HistoryQueries.lastKeptValues(now, 10));
        assertEquals(2, HistoryQueries.LAST_KEPT_QUERY.chars().filter((c) -> c == '?').count());
    }

    @Test
    public void maximumItemsCutsAfterTheLastItemItKeeps() {
        long now = 100 * HistoryQueries.DAY_MS;
        // fewer items than the limit, or no limit: nothing is after the last one kept
        assertEquals(-1L, HistoryQueries.deletionValues(now, 0, 10, null)[2]);
        assertEquals(-1L, HistoryQueries.deletionValues(now, 0, -1, null)[2]);
        // a limit of none keeps nothing
        assertEquals(Long.MAX_VALUE, HistoryQueries.deletionValues(now, 0, 0, null)[2]);
    }
}
