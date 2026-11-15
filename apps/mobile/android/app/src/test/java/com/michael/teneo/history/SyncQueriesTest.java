package com.michael.teneo.history;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import org.junit.Test;

public class SyncQueriesTest {

    @Test
    public void theChangesAreTextRowsAndTombstonesAfterACounterInChangeOrder() {
        assertTrue(SyncQueries.CHANGES_AFTER.contains("FROM CLIPBOARD_ITEMS WHERE kind = 'text' AND syncSeq > ?"));
        assertTrue(SyncQueries.CHANGES_AFTER.endsWith("ORDER BY syncSeq LIMIT ?"));
        // a tombstone is a text row with no value: nothing keeps it out
        assertFalse(SyncQueries.CHANGES_AFTER.contains("deletedAt IS NULL"));
    }

    @Test
    public void everyReadHasTheSameColumnsSoOneMappingFitsThem() {
        for (String sql : new String[] { SyncQueries.CHANGES_AFTER, SyncQueries.ROW, SyncQueries.newestUnpinned(0), SyncQueries.newestUnpinned(3) }) {
            assertTrue(sql, sql.startsWith("SELECT " + SyncQueries.ROW_COLUMNS + " FROM CLIPBOARD_ITEMS"));
        }
    }

    @Test
    public void aTextTooBigToSendIsNotReadSoItCannotBreakTheCursor() {
        assertTrue(SyncQueries.ROW_COLUMNS.contains("CASE WHEN length(CAST(value AS BLOB)) > 1048576 THEN NULL ELSE value END AS value"));
        assertEquals(1024 * 1024, SyncQueries.MAX_TEXT_BYTES);
    }

    @Test
    public void theNewestUnpinnedIsAskedInTheOrderOfTheUnpinnedIndex() {
        assertEquals(
            "SELECT " +
            SyncQueries.ROW_COLUMNS +
            " FROM CLIPBOARD_ITEMS WHERE deletedAt IS NULL AND pinnedAt IS NULL ORDER BY dateCopied DESC, id DESC LIMIT 1",
            SyncQueries.newestUnpinned(0)
        );
    }

    @Test
    public void rowsTheCoreHasWrittenAreLeftOutOfTheNewestUnpinned() {
        assertTrue(SyncQueries.newestUnpinned(3).contains("AND id NOT IN (?, ?, ?) ORDER BY dateCopied DESC, id DESC LIMIT 1"));
        assertThrows(IllegalArgumentException.class, () -> SyncQueries.newestUnpinned(-1));
        assertThrows(IllegalArgumentException.class, () -> SyncQueries.newestUnpinned(SyncQueries.MAX_SKIPPED + 1));
        SyncQueries.newestUnpinned(SyncQueries.MAX_SKIPPED);
    }

    @Test
    public void aPatchChangesOnlyTheFieldsOfADeviceInTheirOwnOrder() {
        assertEquals(Arrays.asList("epoch", "receivedSeq", "lastSeenAt"), SyncQueries.peerFields(Arrays.asList("lastSeenAt", "epoch", "receivedSeq")));
        assertEquals(Collections.emptyList(), SyncQueries.peerFields(Collections.emptyList()));
        assertEquals(
            "UPDATE SYNC_PEERS SET epoch = ?, receivedSeq = ? WHERE deviceId = ?",
            SyncQueries.updatePeer(Arrays.asList("epoch", "receivedSeq"))
        );
    }

    @Test
    public void aPatchThatNamesAnotherColumnIsRefusedBeforeItReachesTheSql() {
        assertThrows(IllegalArgumentException.class, () -> SyncQueries.peerFields(Arrays.asList("name", "deviceId")));
        assertThrows(IllegalArgumentException.class, () -> SyncQueries.peerFields(Collections.singletonList("name = 1; DROP TABLE CLIPBOARD_ITEMS; --")));
    }

    @Test
    public void aDeviceIsCreatedWithoutReplacingWhatIsKnownOfIt() {
        assertEquals("INSERT OR IGNORE INTO SYNC_PEERS (deviceId) VALUES (?)", SyncQueries.CREATE_PEER);
    }

    @Test
    public void thePinStampsAreReadByTheirLargest() {
        assertEquals("SELECT max(pinnedStamp) FROM CLIPBOARD_ITEMS", SyncQueries.LATEST_STAMP);
    }
}
