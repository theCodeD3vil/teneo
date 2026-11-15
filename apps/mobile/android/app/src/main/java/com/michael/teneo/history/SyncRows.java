package com.michael.teneo.history;

import java.util.List;
import java.util.Map;

/**
 * What the sync core reads of the history and writes back: text rows as the
 * database holds them, and the devices it has met. The core maps a row to the
 * record that crosses the wire (apps/mobile/src/sync-service/records.ts), as
 * the Mac does, so these are columns and nothing more.
 */
public final class SyncRows {

    private SyncRows() {}

    /** A text row. `syncSeq` is read, never written: the store hands out its own. */
    public static final class Row {

        public final String id;
        /** null in a tombstone, and for a text too long for sync to send */
        public final String value;
        public final long dateCopied;
        public final String sourceAppName;
        public final String sourceAppBundleId;
        public final Long pinnedAt;
        public final String pinnedStamp;
        public final Long deletedAt;
        public final Long createdAt;
        public final String originDevice;
        /** the secrets found in the text, as the Mac stores them, or null for none */
        public final String secrets;
        public final String linkUrl;
        public final String linkHost;
        /** which detection rules found the secrets and link; null if none looked */
        public final Integer detectorVersion;
        public final long syncSeq;

        public Row(
            String id,
            String value,
            long dateCopied,
            String sourceAppName,
            String sourceAppBundleId,
            Long pinnedAt,
            String pinnedStamp,
            Long deletedAt,
            Long createdAt,
            String originDevice,
            String secrets,
            String linkUrl,
            String linkHost,
            Integer detectorVersion,
            long syncSeq
        ) {
            this.id = id;
            this.value = value;
            this.dateCopied = dateCopied;
            this.sourceAppName = sourceAppName;
            this.sourceAppBundleId = sourceAppBundleId;
            this.pinnedAt = pinnedAt;
            this.pinnedStamp = pinnedStamp;
            this.deletedAt = deletedAt;
            this.createdAt = createdAt;
            this.originDevice = originDevice;
            this.secrets = secrets;
            this.linkUrl = linkUrl;
            this.linkHost = linkHost;
            this.detectorVersion = detectorVersion;
            this.syncSeq = syncSeq;
        }
    }

    /** Rows after a change number, and the store's highest change number, read together */
    public static final class Changes {

        public final List<Row> rows;
        public final long head;
        /** Stopped before `limit` rows to keep the answer small: ask again from the last row */
        public final boolean capped;

        public Changes(List<Row> rows, long head, boolean capped) {
            this.rows = rows;
            this.head = head;
            this.capped = capped;
        }
    }

    /** One row (or none), and the store's highest change number when it was read */
    public static final class Single {

        public final Row row;
        public final long head;

        public Single(Row row, long head) {
            this.row = row;
            this.head = head;
        }
    }

    /** What a device remembers about another one */
    public static final class Peer {

        public final String deviceId;
        public final String name;
        public final String platform;
        public final String epoch;
        public final long receivedSeq;
        public final String lastAddress;
        public final long lastSeenAt;

        public Peer(String deviceId, String name, String platform, String epoch, long receivedSeq, String lastAddress, long lastSeenAt) {
            this.deviceId = deviceId;
            this.name = name;
            this.platform = platform;
            this.epoch = epoch;
            this.receivedSeq = receivedSeq;
            this.lastAddress = lastAddress;
            this.lastSeenAt = lastSeenAt;
        }
    }

    /** Everything one sync transaction writes: rows, and the fields to change for each device (a null value sets NULL) */
    public static final class Batch {

        /** the store's highest change number when the core first read it; null if it read nothing */
        public final Long expectedHead;
        public final List<Row> puts;
        public final Map<String, Map<String, Object>> peers;

        public Batch(Long expectedHead, List<Row> puts, Map<String, Map<String, Object>> peers) {
            this.expectedHead = expectedHead;
            this.puts = puts;
            this.peers = peers;
        }
    }
}
