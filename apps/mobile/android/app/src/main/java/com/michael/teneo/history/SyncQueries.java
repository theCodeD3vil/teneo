package com.michael.teneo.history;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * The SQL the sync core reads the history with, with no database in here so
 * JUnit can test it. The Mac's sync-store.ts runs the same queries, kept to what
 * SQLite 3.22 (Android 10) understands: no upsert.
 */
public final class SyncQueries {

    /** A text longer than this is not sent (packages/sync maxTextBytes), so it is
     *  not read either: one row that big would not fit the cursor's window */
    public static final long MAX_TEXT_BYTES = 1024 * 1024;

    /** The columns sync reads; `value` comes back NULL for a text sync can't send */
    public static final String ROW_COLUMNS =
        "id, CASE WHEN length(CAST(value AS BLOB)) > " +
        MAX_TEXT_BYTES +
        " THEN NULL ELSE value END AS value, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, " +
        "pinnedStamp, deletedAt, createdAt, originDevice, secrets, linkUrl, linkHost, detectorVersion, syncSeq, " +
        "kind, imageSize, imageHash, imageBytes, imageType, color";

    /** Texts, images and tombstones after a change number, oldest change first: `?` is the number, then the most rows */
    public static final String CHANGES_AFTER =
        "SELECT " + ROW_COLUMNS + " FROM CLIPBOARD_ITEMS WHERE kind IN ('text', 'image') AND syncSeq > ? ORDER BY syncSeq LIMIT ?";

    /** As packages/sync maxImageBytes: a larger image stays on the device that copied it */
    public static final long MAX_IMAGE_BYTES = 16L * 1024 * 1024;

    public static final String ROW = "SELECT " + ROW_COLUMNS + " FROM CLIPBOARD_ITEMS WHERE id = ?";

    /** A row's change number, to tell whether it changed since it was read */
    public static final String SYNC_SEQ = "SELECT syncSeq FROM CLIPBOARD_ITEMS WHERE id = ?";

    /** The rows of `count` ids at once, well within sqlite's 999 parameters */
    public static String rows(int count) {
        if (count < 1 || count > MAX_SKIPPED) throw new IllegalArgumentException("Too many rows at once");
        List<String> marks = new ArrayList<>();
        for (int i = 0; i < count; i++) marks.add("?");
        return "SELECT " + ROW_COLUMNS + " FROM CLIPBOARD_ITEMS WHERE id IN (" + String.join(", ", marks) + ")";
    }

    /** The largest pin stamp stored: stamps are fixed-width, so the text order is the time order */
    public static final String LATEST_STAMP = "SELECT max(pinnedStamp) FROM CLIPBOARD_ITEMS";

    public static final String PEER =
        "SELECT deviceId, name, platform, epoch, receivedSeq, lastAddress, lastSeenAt FROM SYNC_PEERS WHERE deviceId = ?";

    public static final String CREATE_PEER = "INSERT OR IGNORE INTO SYNC_PEERS (deviceId) VALUES (?)";

    /** The fields of a device that can be changed: the page's patch may name no others */
    public static final List<String> PEER_FIELDS = Collections.unmodifiableList(
        Arrays.asList("name", "platform", "maker", "epoch", "receivedSeq", "lastAddress", "lastSeenAt")
    );

    /** A skip list this long is more than one batch can make (two rows per received change) */
    public static final int MAX_SKIPPED = 800;

    private SyncQueries() {}

    /**
     * The newest unpinned item that is not deleted, as the Mac's
     * newestUnpinnedQuery asks, in the order of the app's repeat-copy check so it
     * uses the same index. `skipped` rows are left out: those the core has
     * written in a transaction that is not saved yet, which it counts itself.
     */
    public static String newestUnpinned(int skipped) {
        if (skipped < 0 || skipped > MAX_SKIPPED) throw new IllegalArgumentException("Too many rows to skip");
        List<String> marks = new ArrayList<>();
        for (int i = 0; i < skipped; i++) marks.add("?");
        return (
            "SELECT " +
            ROW_COLUMNS +
            " FROM CLIPBOARD_ITEMS WHERE deletedAt IS NULL AND pinnedAt IS NULL" +
            (skipped > 0 ? " AND id NOT IN (" + String.join(", ", marks) + ")" : "") +
            " ORDER BY " +
            HistoryQueries.UNPINNED_ORDER +
            " LIMIT 1"
        );
    }

    /** The fields of a patch, checked against PEER_FIELDS, in the order of PEER_FIELDS */
    public static List<String> peerFields(Collection<String> named) {
        Set<String> wanted = new HashSet<>(named);
        if (!PEER_FIELDS.containsAll(wanted)) throw new IllegalArgumentException("A device has no field of that name");
        List<String> fields = new ArrayList<>();
        for (String field : PEER_FIELDS) if (wanted.contains(field)) fields.add(field);
        return fields;
    }

    /** Sets the named fields of one device: `?` for each, then the device id */
    public static String updatePeer(List<String> fields) {
        List<String> sets = new ArrayList<>();
        for (String field : fields) sets.add(field + " = ?");
        return "UPDATE SYNC_PEERS SET " + String.join(", ", sets) + " WHERE deviceId = ?";
    }
}
