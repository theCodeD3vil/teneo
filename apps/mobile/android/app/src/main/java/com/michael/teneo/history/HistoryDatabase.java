package com.michael.teneo.history;

import android.content.Context;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.security.SecureRandom;

/**
 * The history database file, made the first time it is opened. Its tables are
 * the Mac's (apps/desktop/backend/database.ts and sync/schema.ts), column for
 * column where a text item uses them, so the sync engine reads and writes rows
 * here as it does there.
 */
public final class HistoryDatabase extends SQLiteOpenHelper {

    public static final String NAME = "teneo.sqlite";
    /** 2: SYNC_PEERS has a maker */
    private static final int VERSION = 2;

    HistoryDatabase(Context context, String name) {
        super(context, name, null, VERSION);
        // a page is listed while a copy is saved, without waiting for it
        setWriteAheadLoggingEnabled(true);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        // value is the text; secrets, linkUrl and linkHost are what was found in
        // it, and detectorVersion which detection found them (NULL: not looked
        // at yet). For sync: syncSeq is the row's place in this device's change
        // counter, pinnedStamp the stamp of its latest pin or unpin,
        // originDevice and createdAt the device that first copied it and when.
        // encrypted stays NULL on the phone; the Mac's mapping reads it.
        db.execSQL(
            """
            CREATE TABLE CLIPBOARD_ITEMS (
              id TEXT PRIMARY KEY,
              kind TEXT NOT NULL CHECK(kind = 'text'),
              value TEXT,
              dateCopied INTEGER NOT NULL,
              sourceAppName TEXT,
              sourceAppBundleId TEXT,
              deletedAt INTEGER,
              pinnedAt INTEGER,
              encrypted INTEGER,
              secrets TEXT,
              linkUrl TEXT,
              linkHost TEXT,
              detectorVersion INTEGER,
              syncSeq INTEGER,
              pinnedStamp TEXT,
              originDevice TEXT,
              createdAt INTEGER
            )"""
        );
        // The list reads each page straight off one of these, already in order:
        // the first page and the pinned ones; the pages past the pinned items,
        // the repeat-copy check and the newest-N of "Maximum items"; and the
        // changes a peer has not read yet.
        db.execSQL(
            "CREATE INDEX clipboard_items_list_order_index ON CLIPBOARD_ITEMS " +
            "((pinnedAt IS NULL), pinnedAt DESC, dateCopied DESC, id DESC) WHERE deletedAt IS NULL"
        );
        db.execSQL(
            "CREATE INDEX clipboard_items_unpinned_index ON CLIPBOARD_ITEMS (dateCopied DESC, id DESC) WHERE pinnedAt IS NULL"
        );
        db.execSQL("CREATE INDEX clipboard_items_sync_seq_index ON CLIPBOARD_ITEMS (syncSeq)");

        db.execSQL("CREATE TABLE SYNC_META (key TEXT PRIMARY KEY, value)");
        db.execSQL(
            """
            CREATE TABLE SYNC_PEERS (
              deviceId TEXT PRIMARY KEY,
              name TEXT NOT NULL DEFAULT '',
              platform TEXT NOT NULL DEFAULT '',
              maker TEXT NOT NULL DEFAULT '',
              epoch TEXT,
              receivedSeq INTEGER NOT NULL DEFAULT 0,
              lastAddress TEXT,
              lastSeenAt INTEGER NOT NULL DEFAULT 0
            )"""
        );
        // The epoch is made with the database: a peer that sees another one
        // knows its cursor into this store means nothing. The counter only ever
        // goes up, even when rows are deleted. The device id is 128 random bits,
        // kept for good: on the Mac it lives in the app's store, here with the
        // history it stamps.
        db.execSQL("INSERT INTO SYNC_META (key, value) VALUES ('epoch', ?)", new Object[] { randomHex(8) });
        db.execSQL("INSERT INTO SYNC_META (key, value) VALUES ('seq', 0)");
        db.execSQL("INSERT INTO SYNC_META (key, value) VALUES ('deviceId', ?)", new Object[] { randomHex(16) });

        // the phone's own: its settings, and what Teneo last put on the clipboard
        db.execSQL("CREATE TABLE APP_STATE (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        // who made a device ("google"), as it said: its logo shows by the items copied on it
        if (oldVersion < 2) db.execSQL("ALTER TABLE SYNC_PEERS ADD COLUMN maker TEXT NOT NULL DEFAULT ''");
    }

    private static String randomHex(int bytes) {
        byte[] random = new byte[bytes];
        new SecureRandom().nextBytes(random);
        StringBuilder hex = new StringBuilder();
        for (byte b : random) hex.append(String.format("%02x", b));
        return hex.toString();
    }
}
