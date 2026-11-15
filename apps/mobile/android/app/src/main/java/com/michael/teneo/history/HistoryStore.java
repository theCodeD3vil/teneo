package com.michael.teneo.history;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.os.Build;
import java.io.File;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's clipboard history, as the Mac's database.ts keeps it: one store
 * per database file, shared by everything in the app process: the app's web
 * view (through its plugin), the share screen, and the sync page (through
 * sync/SyncStoreBridge.java). Each method is one transaction, and one runs at a
 * time.
 */
public final class HistoryStore {

    public interface Listener {
        void onHistoryChanged();
    }

    /** An item as the app shows it */
    public static final class Item {

        public final String id;
        public final long dateCopied;
        public final String text;
        public final String sourceAppName;
        public final String sourceAppBundleId;
        /** who made the device it was copied on, such as "google"; null when that device didn't say */
        public final String originMaker;
        public final Long pinnedAt;
        public final List<SecretSpan> secrets;
        public final String linkUrl;
        public final String linkHost;
        public final boolean isTruncated;
        /** which detection rules found the secrets and link; null if none looked */
        public final Integer detectorVersion;
        /** "text" or "image" */
        public final String kind;
        /** an image's file, and its width and height as JSON; null for a text */
        public final File imageFile;
        public final String imageSize;
        /** set when the text is exactly one CSS colour */
        public final String color;

        Item(
            String id,
            long dateCopied,
            String text,
            String sourceAppName,
            String sourceAppBundleId,
            String originMaker,
            Long pinnedAt,
            List<SecretSpan> secrets,
            String linkUrl,
            String linkHost,
            boolean isTruncated,
            Integer detectorVersion,
            String kind,
            File imageFile,
            String imageSize,
            String color
        ) {
            this.color = color;
            this.kind = kind;
            this.imageFile = imageFile;
            this.imageSize = imageSize;
            this.id = id;
            this.dateCopied = dateCopied;
            this.text = text;
            this.sourceAppName = sourceAppName;
            this.sourceAppBundleId = sourceAppBundleId;
            this.originMaker = originMaker;
            this.pinnedAt = pinnedAt;
            this.secrets = secrets;
            this.linkUrl = linkUrl;
            this.linkHost = linkHost;
            this.isTruncated = isTruncated;
            this.detectorVersion = detectorVersion;
        }
    }

    public static final class Page {

        public final List<Item> items;
        /** null once there is no page after this one */
        public final HistoryQueries.ListCursor nextCursor;
        /** how many items match in all; only the first page counts them */
        public final Integer total;

        Page(List<Item> items, HistoryQueries.ListCursor nextCursor, Integer total) {
            this.items = items;
            this.nextCursor = nextCursor;
            this.total = total;
        }
    }

    /** A copied text and what was found in it */
    public static final class NewText {

        public final String text;
        public final String sourceAppName;
        public final String sourceAppBundleId;
        public final List<SecretSpan> secrets;
        public final String linkUrl;
        public final String linkHost;
        /** which detection rules found the secrets and link; null if none looked */
        public final Integer detectorVersion;

        public NewText(
            String text,
            String sourceAppName,
            String sourceAppBundleId,
            List<SecretSpan> secrets,
            String linkUrl,
            String linkHost,
            Integer detectorVersion
        ) {
            this.text = text;
            this.sourceAppName = sourceAppName;
            this.sourceAppBundleId = sourceAppBundleId;
            this.secrets = secrets;
            this.linkUrl = linkUrl;
            this.linkHost = linkHost;
            this.detectorVersion = detectorVersion;
        }
    }

    private static final String SETTING_PREFIX = "setting.";
    private static final String LAST_WRITTEN_CLIP = "lastWrittenClip";
    private static final String LAST_WRITTEN_CLIP_TIME = "lastWrittenClipTime";
    private static final String LAST_SEEN_CLIP = "lastSeenClip";
    private static final String LAST_SEEN_CLIP_TEXT = "lastSeenClipText";

    // Who made the device an item was copied on: this phone for its own copies
    // (kept in SYNC_META when the history opens), else what that device said
    // when it connected. Empty or NULL when it never said.
    private static final String ORIGIN_MAKER =
        "CASE WHEN originDevice = (SELECT value FROM SYNC_META WHERE key = 'deviceId') " +
        "THEN (SELECT value FROM SYNC_META WHERE key = 'maker') " +
        "ELSE (SELECT maker FROM SYNC_PEERS WHERE deviceId = originDevice) END AS originMaker";

    // A text holding a secret is read whole, so the search can tell the
    // secret from the rest; any other only as far as the list shows it
    private static final String LIST_COLUMNS =
        "id, kind, path, imageSize, color, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, secrets, linkUrl, linkHost, detectorVersion, " +
        ORIGIN_MAKER +
        ", " +
        "CASE WHEN secrets IS NOT NULL THEN value ELSE substr(value, 1, " +
        HistoryText.PREVIEW_LENGTH +
        ") END AS value, length(value) AS valueLength";
    private static final String ITEM_COLUMNS =
        "id, kind, path, imageSize, color, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, secrets, linkUrl, linkHost, detectorVersion, " +
        ORIGIN_MAKER +
        ", value, length(value) AS valueLength";

    private static final Map<String, HistoryStore> stores = new HashMap<>();

    /** The folder, inside the app's files, that holds the history's images */
    public static final String IMAGES_FOLDER = "images";

    private final HistoryDatabase helper;
    private final SQLiteDatabase db;
    private final Hlc clock;
    private final String deviceId;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final ImageFiles images;
    /** The files of images a sync batch deleted: removed once the batch is saved */
    private final List<String> removedImages = new ArrayList<>();

    private HistoryStore(HistoryDatabase helper, File imagesFolder) {
        this.helper = helper;
        images = new ImageFiles(imagesFolder);
        images.forgetArriving();
        db = helper.getWritableDatabase();
        deviceId = metaString("deviceId");
        clock = new Hlc(deviceId, System::currentTimeMillis);
        // for the logo by this phone's own copies (ORIGIN_MAKER)
        String maker = Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        db.execSQL("INSERT OR REPLACE INTO SYNC_META (key, value) VALUES ('maker', ?)", new Object[] { maker });
        // the clock starts past every pin made before, even if the phone's
        // time has since gone back
        try (Cursor latest = db.rawQuery("SELECT max(pinnedStamp) FROM CLIPBOARD_ITEMS", null)) {
            if (latest.moveToFirst() && !latest.isNull(0)) clock.observe(latest.getString(0));
        }
    }

    /** The app's history */
    public static HistoryStore get(Context context) {
        return get(context, HistoryDatabase.NAME);
    }

    /** The history in database file `name`, opened on first use. Opening applies the history limits: time has passed since the app last ran. */
    public static synchronized HistoryStore get(Context context, String name) {
        HistoryStore store = stores.get(name);
        if (store == null) {
            Context app = context.getApplicationContext();
            // a test database keeps its images apart from the history's
            File imagesFolder = new File(app.getFilesDir(), HistoryDatabase.NAME.equals(name) ? IMAGES_FOLDER : IMAGES_FOLDER + "-" + name);
            store = new HistoryStore(new HistoryDatabase(app, name), imagesFolder);
            stores.put(name, store);
            store.applyLimits(System.currentTimeMillis());
        }
        return store;
    }

    /** Close database file `name` if it is open and delete it */
    public static synchronized void delete(Context context, String name) {
        HistoryStore store = stores.remove(name);
        if (store != null) {
            synchronized (store) {
                store.helper.close();
            }
        }
        context.getApplicationContext().deleteDatabase(name);
    }

    public String deviceId() {
        return deviceId;
    }

    /** `listener` runs after each change to this history, on the thread that made it */
    public void addListener(Listener listener) {
        listeners.add(listener);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    private void notifyChanged() {
        for (Listener listener : listeners) {
            try {
                listener.onHistoryChanged();
            } catch (RuntimeException ignored) {
                // the change is made: a listener must not undo that by throwing
            }
        }
    }

    // ---- the list

    /**
     * One page of the history, pinned items first, then newest first. The
     * query matches a page's worth of rows; the few a row-by-row search check
     * then drops (a search hit inside a hidden secret) are made up for from
     * the rows after them.
     */
    public synchronized Page list(String kind, String search, HistoryQueries.ListCursor cursor, int limit) {
        String query = search == null ? "" : search.trim().toLowerCase(java.util.Locale.ROOT);
        int wanted = Math.max(1, limit);
        boolean hideSecrets = hideSecrets();
        // sqlite's LIKE ignores case for ASCII letters only. Any other search
        // ("école" for "ÉCOLE") is matched row by row instead, on whole texts.
        boolean likeFinds = HistoryText.isAscii(query);
        String columns = likeFinds ? LIST_COLUMNS : ITEM_COLUMNS;
        List<Item> items = new ArrayList<>();
        HistoryQueries.ListCursor after = cursor;
        boolean exhausted = false;

        while (items.size() < wanted && !exhausted) {
            int batchSize = Math.max(wanted - items.size(), 20);
            HistoryQueries.Condition where = HistoryQueries.listConditions(kind, likeFinds ? query : "", after);
            List<Object> values = new ArrayList<>(where.values);
            values.add(batchSize);
            String sql =
                "SELECT " +
                columns +
                " FROM CLIPBOARD_ITEMS WHERE " +
                where.sql +
                " ORDER BY " +
                HistoryQueries.pageOrder(after) +
                " LIMIT ?";
            int rows = 0;
            boolean reachedLimit = false;
            try (Cursor row = db.rawQuery(sql, args(values))) {
                while (row.moveToNext()) {
                    rows++;
                    after = new HistoryQueries.ListCursor(nullableLong(row, "pinnedAt"), longColumn(row, "dateCopied"), string(row, "id"));
                    List<SecretSpan> secrets = parseSecrets(string(row, "secrets"));
                    String text = string(row, "value");
                    if (!query.isEmpty() && (!likeFinds || !secrets.isEmpty())) {
                        boolean matches = HistoryText.matchesSearch(
                            text,
                            secrets,
                            string(row, "sourceAppName"),
                            string(row, "linkHost"),
                            query,
                            hideSecrets
                        );
                        if (!matches) continue;
                    }
                    items.add(toItem(row, secrets, true));
                    if (items.size() == wanted) {
                        reachedLimit = true;
                        break;
                    }
                }
            }
            if (!reachedLimit && rows < batchSize) exhausted = true;
        }

        Integer total = cursor == null ? count(kind, query, hideSecrets) : null;
        return new Page(items, exhausted ? null : after, total);
    }

    private int count(String kind, String query, boolean hideSecrets) {
        boolean likeFinds = HistoryText.isAscii(query);
        HistoryQueries.Condition where = HistoryQueries.listConditions(kind, likeFinds ? query : "", null);
        if (query.isEmpty()) {
            return (int) longQuery("SELECT COUNT(*) FROM CLIPBOARD_ITEMS WHERE " + where.sql, where.values);
        }
        // rows sqlite could judge by itself are counted there; the rest row by row
        long count = likeFinds
            ? longQuery("SELECT COUNT(*) FROM CLIPBOARD_ITEMS WHERE " + where.sql + " AND secrets IS NULL", where.values)
            : 0;
        String sql =
            "SELECT value, secrets, sourceAppName, linkHost FROM CLIPBOARD_ITEMS WHERE " +
            where.sql +
            (likeFinds ? " AND secrets IS NOT NULL" : "");
        try (Cursor row = db.rawQuery(sql, args(where.values))) {
            while (row.moveToNext()) {
                List<SecretSpan> secrets = parseSecrets(row.getString(1));
                if (HistoryText.matchesSearch(row.getString(0), secrets, row.getString(2), row.getString(3), query, hideSecrets)) {
                    count++;
                }
            }
        }
        return (int) count;
    }

    /** One item whole, with all of its text, or null once it's gone from the history */
    public synchronized Item getItem(String id) {
        try (
            Cursor row = db.rawQuery(
                "SELECT " + ITEM_COLUMNS + " FROM CLIPBOARD_ITEMS WHERE id = ? AND deletedAt IS NULL",
                new String[] { id }
            )
        ) {
            if (!row.moveToFirst()) return null;
            return toItem(row, parseSecrets(string(row, "secrets")), false);
        }
    }

    // ---- changes

    /** Pinned items list first, newest pin first, and the limits leave them alone. False if there is no such item. */
    public boolean setPinned(String id, boolean pinned) {
        boolean changed;
        synchronized (this) {
            changed = inTransaction(() -> {
                ContentValues values = new ContentValues();
                values.put("pinnedAt", pinned ? System.currentTimeMillis() : null);
                // an unpin gets a stamp too: it has to win over the pin it undoes
                values.put("pinnedStamp", clock.next());
                values.put("syncSeq", nextSyncSeq());
                return db.update("CLIPBOARD_ITEMS", values, "id = ? AND deletedAt IS NULL", new String[] { id }) > 0;
            });
        }
        if (changed) notifyChanged();
        return changed;
    }

    /**
     * Take an item out of the history. Its row stays as a tombstone, with no
     * text, so a device this one syncs with later deletes it too; the
     * tombstone goes after 30 days. False if there is no such item.
     */
    public boolean deleteItem(String id) {
        boolean changed;
        synchronized (this) {
            // an image's file goes with it, after its row
            String imagePath = pathOf(id);
            changed = inTransaction(() -> {
                ContentValues values = new ContentValues();
                values.put("deletedAt", System.currentTimeMillis());
                values.putNull("pinnedAt");
                values.put("syncSeq", nextSyncSeq());
                for (String column : new String[] { "value", "secrets", "linkUrl", "linkHost", "encrypted", "path", "color" }) {
                    values.putNull(column);
                }
                return db.update("CLIPBOARD_ITEMS", values, "id = ? AND deletedAt IS NULL", new String[] { id }) > 0;
            });
            if (changed) images.remove(imagePath);
        }
        if (changed) notifyChanged();
        return changed;
    }

    /**
     * Save a copied text, copied at `dateCopied`, and apply the history limits.
     * The same text as the newest unpinned item bumps that one to the top
     * instead of adding a row, as on the Mac. Returns the item's id.
     */
    public String saveText(NewText copy, long dateCopied) {
        if (copy.text == null || copy.text.isEmpty()) throw new IllegalArgumentException("There is no text to save");
        String id;
        synchronized (this) {
            id = inTransaction(() -> {
                String repeated = repeatedCopy(copy.text);
                if (repeated != null) {
                    // never back in time: the clip may be older than the row, as
                    // when the text was shared to Teneo after it was copied
                    db.execSQL(
                        "UPDATE CLIPBOARD_ITEMS SET dateCopied = MAX(dateCopied, ?), sourceAppName = ?, sourceAppBundleId = ?, syncSeq = ? WHERE id = ?",
                        new Object[] { dateCopied, copy.sourceAppName, copy.sourceAppBundleId, nextSyncSeq(), repeated }
                    );
                    return repeated;
                }
                String newId = UUID.randomUUID().toString();
                ContentValues values = new ContentValues();
                values.put("id", newId);
                values.put("kind", "text");
                values.put("value", copy.text);
                values.put("dateCopied", dateCopied);
                values.put("sourceAppName", copy.sourceAppName);
                values.put("sourceAppBundleId", copy.sourceAppBundleId);
                values.put("secrets", serializeSecrets(copy.secrets));
                boolean hasLink = copy.linkUrl != null && copy.linkHost != null;
                values.put("linkUrl", hasLink ? copy.linkUrl : null);
                values.put("linkHost", hasLink ? copy.linkHost : null);
                values.put("detectorVersion", copy.detectorVersion);
                values.put("createdAt", dateCopied);
                values.put("originDevice", deviceId);
                values.put("syncSeq", nextSyncSeq());
                db.insertOrThrow("CLIPBOARD_ITEMS", null, values);
                return newId;
            });
            deleteBeyondLimits(System.currentTimeMillis());
        }
        notifyChanged();
        return id;
    }

    /**
     * Give every text holding a secret a new place in the change counter, so
     * sync sends it. For when the user allows items with secrets to sync: the
     * other devices' cursors are past those items, which were held back, and
     * only a newer change number reaches them. As the Mac's
     * restampSecretItems. Returns how many were restamped.
     */
    public int restampSecretItems() {
        int restamped;
        synchronized (this) {
            restamped = inTransaction(() -> {
                List<String> ids = new ArrayList<>();
                try (
                    Cursor row = db.rawQuery(
                        "SELECT id FROM CLIPBOARD_ITEMS WHERE kind = 'text' AND deletedAt IS NULL AND secrets IS NOT NULL ORDER BY syncSeq",
                        null
                    )
                ) {
                    while (row.moveToNext()) ids.add(row.getString(0));
                }
                for (String id : ids) {
                    ContentValues values = new ContentValues();
                    values.put("syncSeq", nextSyncSeq());
                    db.update("CLIPBOARD_ITEMS", values, "id = ?", new String[] { id });
                }
                return ids.size();
            });
        }
        // nothing shown changes, but sync has something new to send
        if (restamped > 0) notifyChanged();
        return restamped;
    }

    /** The newest unpinned item, when it holds `text` */
    private String repeatedCopy(String text) {
        try (
            Cursor latest = db.rawQuery(
                "SELECT id, value FROM CLIPBOARD_ITEMS WHERE deletedAt IS NULL AND pinnedAt IS NULL " +
                "ORDER BY " +
                HistoryQueries.UNPINNED_ORDER +
                " LIMIT 1",
                null
            )
        ) {
            return latest.moveToFirst() && text.equals(latest.getString(1)) ? latest.getString(0) : null;
        }
    }

    /** Delete what "Keep history for" and "Maximum items" no longer keep, and the tombstones past their 30 days */
    public void applyLimits(long now) {
        boolean changed;
        synchronized (this) {
            changed = deleteBeyondLimits(now);
        }
        if (changed) notifyChanged();
    }

    private boolean deleteBeyondLimits(long now) {
        Map<String, Object> settings = readSettings();
        long copiedBefore = HistoryQueries.copiedBefore(
            now,
            Settings.count(settings, Settings.HISTORY_RETENTION_DAYS, Settings.DEFAULT_HISTORY_RETENTION_DAYS)
        );
        long keepNewest = HistoryQueries.keepNewest(Settings.count(settings, Settings.MAX_ITEMS, Settings.DEFAULT_MAX_ITEMS));
        // the files of the images the limits delete, removed after their rows
        List<String> imagePaths = new ArrayList<>();
        boolean changed = inTransaction(() -> {
            // Tombstones past their 30 days go first: "Maximum items" keeps the
            // newest N rows that are not young tombstones, and an old one left
            // in would take a live item's place among them. They are already
            // out of the list, so deleting them changes nothing shown.
            db.delete(
                "CLIPBOARD_ITEMS",
                HistoryQueries.TOMBSTONE_ROW + " AND deletedAt < ?",
                new String[] { String.valueOf(now - HistoryQueries.TOMBSTONE_LIFETIME_MS) }
            );
            int deleted = 0;
            if (HistoryQueries.limitsHistory(copiedBefore, keepNewest)) {
                Object[] values = HistoryQueries.deletionValues(now, copiedBefore, keepNewest);
                try (
                    Cursor row = db.rawQuery(
                        "SELECT path FROM CLIPBOARD_ITEMS WHERE path IS NOT NULL AND " + HistoryQueries.DELETION_CONDITION,
                        args(java.util.Arrays.asList(values))
                    )
                ) {
                    while (row.moveToNext()) imagePaths.add(row.getString(0));
                }
                deleted += db.delete("CLIPBOARD_ITEMS", HistoryQueries.DELETION_CONDITION, args(java.util.Arrays.asList(values)));
            }
            return deleted > 0;
        });
        for (String path : imagePaths) images.remove(path);
        return changed;
    }

    // ---- settings

    /** The settings saved so far; one never saved is missing */
    public synchronized Map<String, Object> settings() {
        return readSettings();
    }

    /** Save the known settings among `changes` and apply the limits they set. Returns all saved settings. */
    public Map<String, Object> updateSettings(Map<String, ?> changes) {
        Map<String, Object> clean = Settings.sanitize(changes);
        boolean trimmed = false;
        Map<String, Object> saved;
        synchronized (this) {
            inTransaction(() -> {
                for (Map.Entry<String, Object> entry : clean.entrySet()) {
                    writeState(SETTING_PREFIX + entry.getKey(), Settings.format(entry.getValue()));
                }
                return null;
            });
            if (clean.containsKey(Settings.HISTORY_RETENTION_DAYS) || clean.containsKey(Settings.MAX_ITEMS)) {
                trimmed = deleteBeyondLimits(System.currentTimeMillis());
            }
            saved = readSettings();
        }
        if (trimmed) notifyChanged();
        return saved;
    }

    private Map<String, Object> readSettings() {
        Map<String, Object> settings = new LinkedHashMap<>();
        try (Cursor row = db.rawQuery("SELECT key, value FROM APP_STATE WHERE substr(key, 1, ?) = ?", new String[] {
            String.valueOf(SETTING_PREFIX.length()),
            SETTING_PREFIX,
        })) {
            while (row.moveToNext()) {
                String key = row.getString(0).substring(SETTING_PREFIX.length());
                Object value = Settings.parse(key, row.getString(1));
                if (value != null) settings.put(key, value);
            }
        }
        return settings;
    }

    private boolean hideSecrets() {
        return Settings.bool(readSettings(), Settings.HIDE_SECRETS, Settings.DEFAULT_HIDE_SECRETS);
    }

    // ---- what Teneo put on the clipboard

    /** Note that Teneo put `text` on the clipboard. Only a hash is kept: the text may be a secret. */
    public synchronized void rememberWrittenClip(String text) {
        writeState(LAST_WRITTEN_CLIP, sha256(text));
        writeState(LAST_WRITTEN_CLIP_TIME, "0");
    }

    /** The time Android gave the clip Teneo just wrote, so the same text copied again later isn't taken for it */
    public synchronized void rememberWrittenClipTime(long copiedAt) {
        writeState(LAST_WRITTEN_CLIP_TIME, String.valueOf(copiedAt));
    }

    /** Whether `text` is what Teneo last put on the clipboard */
    public synchronized boolean isWrittenClip(String text) {
        String written = readState(LAST_WRITTEN_CLIP);
        return written != null && written.equals(sha256(text));
    }

    /** The time of the clip Teneo last wrote, 0 if it isn't known */
    public synchronized long writtenClipTime() {
        return longState(LAST_WRITTEN_CLIP_TIME);
    }

    /** Another clip is on the clipboard now: what Teneo wrote is no longer there to skip */
    public synchronized void forgetWrittenClip() {
        db.delete("APP_STATE", "key IN (?, ?)", new String[] { LAST_WRITTEN_CLIP, LAST_WRITTEN_CLIP_TIME });
    }

    /** The time of the last clip the capture read, 0 for none */
    public synchronized long seenClip() {
        return longState(LAST_SEEN_CLIP);
    }

    /** Whether `text` is what the capture last read. Only a hash is kept. */
    public synchronized boolean isSeenClipText(String text) {
        String seen = readState(LAST_SEEN_CLIP_TEXT);
        return seen != null && seen.equals(sha256(text));
    }

    public synchronized void rememberSeenClipText(String text) {
        writeState(LAST_SEEN_CLIP_TEXT, sha256(text));
    }

    private String readState(String key) {
        try (Cursor row = db.rawQuery("SELECT value FROM APP_STATE WHERE key = ?", new String[] { key })) {
            return row.moveToFirst() ? row.getString(0) : null;
        }
    }

    private long longState(String key) {
        String value = readState(key);
        if (value == null) return 0;
        try {
            return Long.parseLong(value);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    /** Note that the capture read the clip copied at `copiedAt`, so it isn't saved again */
    public synchronized void rememberSeenClip(long copiedAt) {
        writeState(LAST_SEEN_CLIP, String.valueOf(copiedAt));
    }

    // ---- what was found in each text

    /** A text whose secrets and link haven't been looked for with the current rules */
    public static final class Undetected {

        public final String id;
        public final String text;

        Undetected(String id, String text) {
            this.id = id;
            this.text = text;
        }
    }

    /** What the rules of one version found in a text */
    public static final class Detection {

        public final String id;
        public final List<SecretSpan> secrets;
        public final String linkUrl;
        public final String linkHost;
        /** the text itself, when it is exactly one CSS colour; else null */
        public final String color;

        public Detection(String id, List<SecretSpan> secrets, String linkUrl, String linkHost, String color) {
            this.color = color;
            this.id = id;
            this.secrets = secrets;
            this.linkUrl = linkUrl;
            this.linkHost = linkHost;
        }
    }

    /**
     * Up to `limit` texts, newest first, that no rules of `version` have looked
     * at: saved by the capture, which leaves the looking to the app, or looked
     * at by older rules, as the Mac's refreshDetectionMetadata finds them.
     */
    public synchronized List<Undetected> undetected(int version, int limit) {
        List<Undetected> texts = new ArrayList<>();
        try (
            Cursor row = db.rawQuery(
                "SELECT id, value FROM CLIPBOARD_ITEMS " +
                "WHERE kind = 'text' AND value IS NOT NULL AND deletedAt IS NULL " +
                "AND (detectorVersion IS NULL OR detectorVersion < ?) " +
                "ORDER BY dateCopied DESC, id DESC LIMIT ?",
                new String[] { String.valueOf(version), String.valueOf(Math.max(1, limit)) }
            )
        ) {
            while (row.moveToNext()) texts.add(new Undetected(row.getString(0), row.getString(1)));
        }
        return texts;
    }

    /**
     * Store what the rules of `version` found. A text deleted since is left
     * alone. Throws, saving none, if a secret lies outside its text. Listeners
     * only hear of it when what an item shows changed: a text with nothing
     * found in it looks the same as before.
     */
    public void saveDetections(List<Detection> detections, int version) {
        boolean changed;
        synchronized (this) {
            changed = inTransaction(() -> {
                boolean any = false;
                for (Detection found : detections) {
                    String text = null;
                    String oldSecrets = null;
                    String oldLinkUrl = null;
                    String oldColor = null;
                    try (
                        Cursor row = db.rawQuery(
                            "SELECT value, secrets, linkUrl, color FROM CLIPBOARD_ITEMS WHERE id = ?",
                            new String[] { found.id }
                        )
                    ) {
                        if (row.moveToFirst() && !row.isNull(0)) {
                            text = row.getString(0);
                            oldSecrets = row.isNull(1) ? null : row.getString(1);
                            oldLinkUrl = row.isNull(2) ? null : row.getString(2);
                            oldColor = row.isNull(3) ? null : row.getString(3);
                        }
                    }
                    if (text == null) continue;
                    for (SecretSpan secret : found.secrets) {
                        if (secret.start < 0 || secret.end > text.length() || secret.start >= secret.end) {
                            throw new IllegalArgumentException("A secret is outside the text");
                        }
                    }
                    boolean hasLink = found.linkUrl != null && found.linkHost != null;
                    ContentValues values = new ContentValues();
                    String newSecrets = serializeSecrets(found.secrets);
                    String newLinkUrl = hasLink ? found.linkUrl : null;
                    values.put("secrets", newSecrets);
                    values.put("linkUrl", newLinkUrl);
                    values.put("linkHost", hasLink ? found.linkHost : null);
                    values.put("color", found.color);
                    values.put("detectorVersion", version);
                    boolean saved = db.update("CLIPBOARD_ITEMS", values, "id = ?", new String[] { found.id }) > 0;
                    boolean isSame = Objects.equals(oldSecrets, newSecrets) && Objects.equals(oldLinkUrl, newLinkUrl) && Objects.equals(oldColor, found.color);
                    any |= saved && !isSame;
                }
                return any;
            });
        }
        if (changed) notifyChanged();
    }

    // ---- sync: what the sync core reads and writes, through its page's bridge
    // (sync/SyncStoreBridge.java). The core can't open this database, so it asks
    // here. Reads are single calls, each from one snapshot: every writer holds
    // this store's monitor, so nothing changes in the middle of one.

    /** Made with the database: another one tells a peer that its cursor into this store means nothing */
    public String syncEpoch() {
        return metaString("epoch");
    }

    /** The highest change number handed out so far */
    private long head() {
        return longQuery("SELECT value FROM SYNC_META WHERE key = 'seq'", Collections.emptyList());
    }

    /**
     * Rows with a change number above `after`, oldest change first, at most
     * `limit`, and the highest change number, all from one moment. Stops early
     * once their texts add up to `maxChars`, so an answer stays small: the core
     * asks again from the last row.
     */
    public synchronized SyncRows.Changes syncChangesAfter(long after, int limit, long maxChars) {
        int wanted = Math.max(1, limit);
        List<SyncRows.Row> rows = new ArrayList<>();
        boolean capped = false;
        long chars = 0;
        try (Cursor row = db.rawQuery(SyncQueries.CHANGES_AFTER, new String[] { String.valueOf(after), String.valueOf(wanted) })) {
            while (row.moveToNext()) {
                SyncRows.Row read = toSyncRow(row);
                rows.add(read);
                chars += read.value == null ? 0 : read.value.length();
                if (chars >= maxChars && rows.size() < wanted) {
                    capped = true;
                    break;
                }
            }
        }
        return new SyncRows.Changes(rows, head(), capped);
    }

    /** One row, deleted or not, or null; and the highest change number then */
    public synchronized SyncRows.Single syncRow(String id) {
        try (Cursor row = db.rawQuery(SyncQueries.ROW, new String[] { id })) {
            return new SyncRows.Single(row.moveToFirst() ? toSyncRow(row) : null, head());
        }
    }

    /** The newest unpinned item that is not deleted, leaving out the rows in `skipped`; and the highest change number then */
    public synchronized SyncRows.Single syncNewestUnpinned(List<String> skipped) {
        try (Cursor row = db.rawQuery(SyncQueries.newestUnpinned(skipped.size()), skipped.toArray(new String[0]))) {
            return new SyncRows.Single(row.moveToFirst() ? toSyncRow(row) : null, head());
        }
    }

    public synchronized SyncRows.Peer syncPeer(String deviceId) {
        try (Cursor row = db.rawQuery(SyncQueries.PEER, new String[] { deviceId })) {
            if (!row.moveToFirst()) return null;
            return new SyncRows.Peer(
                string(row, "deviceId"),
                string(row, "name"),
                string(row, "platform"),
                string(row, "epoch"),
                longColumn(row, "receivedSeq"),
                string(row, "lastAddress"),
                longColumn(row, "lastSeenAt")
            );
        }
    }

    /** The largest pin stamp stored, or null: the core starts its clock past it */
    public synchronized String syncLatestStamp() {
        try (Cursor row = db.rawQuery(SyncQueries.LATEST_STAMP, null)) {
            return row.moveToFirst() && !row.isNull(0) ? row.getString(0) : null;
        }
    }

    /**
     * Save what the core wrote in one of its transactions, all of it or none.
     * Every row gets a change number of its own, so it travels on to the
     * other devices. False, with nothing saved, when something else wrote to
     * the history since the core read it (`expectedHead` is no longer the
     * highest change number): what it decided from is out of date, so it reads
     * again and decides again.
     */
    public boolean syncApply(SyncRows.Batch batch) {
        boolean applied;
        synchronized (this) {
            removedImages.clear();
            applied = inTransaction(() -> {
                if (batch.expectedHead != null && head() != batch.expectedHead) return false;
                for (SyncRows.Row row : batch.puts) writeSyncRow(row);
                for (Map.Entry<String, Map<String, Object>> peer : batch.peers.entrySet()) writePeer(peer.getKey(), peer.getValue());
                return true;
            });
            // the files of images the batch deleted go after their rows
            if (applied) for (String path : removedImages) images.remove(path);
            removedImages.clear();
        }
        if (applied && !batch.puts.isEmpty()) notifyChanged();
        return applied;
    }

    /** Replaces the row's sync columns, or inserts it. A new row keeps who first copied it, and when. */
    private void writeSyncRow(SyncRows.Row row) {
        // pin stamps made elsewhere: a pin made here from now on has to beat them
        if (row.pinnedStamp != null) clock.observe(row.pinnedStamp);
        if ("image".equals(row.kind)) {
            writeSyncImage(row);
            return;
        }
        ContentValues values = new ContentValues();
        values.put("value", row.value);
        values.put("dateCopied", row.dateCopied);
        values.put("sourceAppName", row.sourceAppName);
        values.put("sourceAppBundleId", row.sourceAppBundleId);
        values.put("pinnedAt", row.pinnedAt);
        values.put("pinnedStamp", row.pinnedStamp);
        values.put("deletedAt", row.deletedAt);
        values.put("secrets", row.secrets);
        values.put("linkUrl", row.linkUrl);
        values.put("linkHost", row.linkHost);
        values.put("color", row.color);
        values.put("detectorVersion", row.detectorVersion);
        values.put("syncSeq", nextSyncSeq());
        if (db.update("CLIPBOARD_ITEMS", values, "id = ?", new String[] { row.id }) > 0) return;
        values.put("id", row.id);
        values.put("kind", "text");
        values.put("createdAt", row.createdAt);
        values.put("originDevice", row.originDevice);
        db.insertOrThrow("CLIPBOARD_ITEMS", null, values);
    }

    /**
     * An image row from another device. A new one has no file: its bytes come
     * after it (imageWrite), and it isn't listed until they have. A deleted
     * one loses its file.
     */
    private void writeSyncImage(SyncRows.Row row) {
        ContentValues values = new ContentValues();
        values.put("dateCopied", row.dateCopied);
        values.put("sourceAppName", row.sourceAppName);
        values.put("sourceAppBundleId", row.sourceAppBundleId);
        values.put("pinnedAt", row.pinnedAt);
        values.put("pinnedStamp", row.pinnedStamp);
        values.put("deletedAt", row.deletedAt);
        values.put("syncSeq", nextSyncSeq());
        if (row.deletedAt != null) {
            String path = pathOf(row.id);
            if (path != null) removedImages.add(path);
            values.putNull("path");
        }
        if (db.update("CLIPBOARD_ITEMS", values, "id = ? AND kind = 'image'", new String[] { row.id }) > 0) return;
        values.put("id", row.id);
        values.put("kind", "image");
        values.put("createdAt", row.createdAt);
        values.put("originDevice", row.originDevice);
        if (row.image != null && row.deletedAt == null) {
            values.put("imageSize", row.image.size);
            values.put("imageHash", row.image.hash);
            values.put("imageBytes", row.image.bytes);
            values.put("imageType", row.image.type);
        }
        db.insertOrThrow("CLIPBOARD_ITEMS", null, values);
    }

    /** The name of an item's image file, or null: it is no image, or has no file */
    private String pathOf(String id) {
        try (Cursor row = db.rawQuery("SELECT path FROM CLIPBOARD_ITEMS WHERE id = ?", new String[] { id })) {
            return row.moveToFirst() && !row.isNull(0) ? row.getString(0) : null;
        }
    }

    // ---- images: their bytes, for sync (the sync core's ImageStore) and for copies made here

    private static final String WAITING_FOR = "kind = 'image' AND deletedAt IS NULL AND path IS NULL AND imageHash = ?";

    /** A file this phone holds whose bytes have this hash, or null */
    private File holderOf(String hash) {
        try (
            Cursor row = db.rawQuery(
                "SELECT path, imageBytes FROM CLIPBOARD_ITEMS WHERE kind = 'image' AND deletedAt IS NULL AND path IS NOT NULL AND imageHash = ?",
                new String[] { hash }
            )
        ) {
            while (row.moveToNext()) {
                File file = images.file(row.getString(0));
                if (file != null && file.isFile() && file.length() == row.getLong(1)) return file;
            }
        }
        return null;
    }

    /** Give every row that waits for this hash a copy of `source`, each its own: a row's file goes when the row does. */
    private boolean hand(String hash, File source) {
        List<String[]> waiting = new ArrayList<>();
        try (Cursor row = db.rawQuery("SELECT id, imageType FROM CLIPBOARD_ITEMS WHERE " + WAITING_FOR, new String[] { hash })) {
            while (row.moveToNext()) waiting.add(new String[] { row.getString(0), row.getString(1) });
        }
        boolean handed = false;
        for (String[] row : waiting) {
            try {
                String name = images.keep(source, row[1]);
                ContentValues values = new ContentValues();
                values.put("path", name);
                if (db.update("CLIPBOARD_ITEMS", values, "id = ? AND path IS NULL AND deletedAt IS NULL", new String[] { row[0] }) > 0) {
                    handed = true;
                } else {
                    images.remove(name);
                }
            } catch (IOException unwritable) {
                // asked for again on the next connection
            }
        }
        return handed;
    }

    /** The hashes of the images in the history whose bytes this phone does not hold yet */
    public List<String> imagesMissing() {
        List<String> missing = new ArrayList<>();
        boolean handed = false;
        synchronized (this) {
            List<String> hashes = new ArrayList<>();
            try (
                Cursor row = db.rawQuery(
                    "SELECT DISTINCT imageHash FROM CLIPBOARD_ITEMS WHERE kind = 'image' AND deletedAt IS NULL AND path IS NULL AND imageHash IS NOT NULL",
                    null
                )
            ) {
                while (row.moveToNext()) hashes.add(row.getString(0));
            }
            for (String hash : hashes) {
                // the same picture is already here, under another item
                File held = holderOf(hash);
                if (held != null) handed = hand(hash, held) || handed;
                else missing.add(hash);
            }
        }
        if (handed) notifyChanged();
        return missing;
    }

    /** How long the image with this hash is, or -1 when this phone does not hold it */
    public synchronized long imageSize(String hash) {
        File held = ImageFiles.isHash(hash) ? holderOf(hash) : null;
        return held == null ? -1 : held.length();
    }

    /** A piece of it, or null when it can't be read */
    public synchronized byte[] imageRead(String hash, long offset, int length) {
        File held = ImageFiles.isHash(hash) ? holderOf(hash) : null;
        if (held == null || offset < 0 || length < 1 || offset + length > held.length()) return null;
        try (RandomAccessFile file = new RandomAccessFile(held, "r")) {
            byte[] piece = new byte[length];
            file.seek(offset);
            file.readFully(piece);
            return piece;
        } catch (IOException unreadable) {
            return null;
        }
    }

    /**
     * Keep a piece of an image that is arriving from another device. Pieces
     * come in order from offset 0. "done" once the last is in and the whole is
     * what was asked for: the rows that waited for it get their file. Anything
     * else is "refused" and dropped: bytes nobody waits for, a piece out of
     * order, or a whole that has another hash or is no image of its kind.
     */
    public String imageWrite(String hash, long offset, long total, byte[] piece) {
        String result;
        synchronized (this) {
            result = writePiece(hash, offset, total, piece);
        }
        if (result.equals("done")) notifyChanged();
        return result;
    }

    private String writePiece(String hash, long offset, long total, byte[] piece) {
        File part = null;
        try {
            part = images.arriving(hash);
            if (part == null || piece == null || piece.length == 0 || offset < 0 || offset + piece.length > total) {
                return refuse(part);
            }
            Long expectedBytes = null;
            String type = null;
            try (Cursor row = db.rawQuery("SELECT imageBytes, imageType FROM CLIPBOARD_ITEMS WHERE " + WAITING_FOR + " LIMIT 1", new String[] { hash })) {
                if (row.moveToFirst()) {
                    expectedBytes = row.getLong(0);
                    type = row.getString(1);
                }
            }
            if (expectedBytes == null || expectedBytes != total || total > SyncQueries.MAX_IMAGE_BYTES || !ImageFiles.TYPES.contains(type)) {
                return refuse(part);
            }
            // pieces come in order: what is there so far must end where this begins
            long sofar = offset == 0 ? 0 : (part.isFile() ? part.length() : -1);
            if (sofar != offset) return refuse(part);
            try (RandomAccessFile file = new RandomAccessFile(part, "rw")) {
                if (offset == 0) file.setLength(0);
                file.seek(offset);
                file.write(piece);
            }
            if (offset + piece.length < total) return "more";

            boolean isWhole = part.length() == total && ImageFiles.looksLike(type, ImageFiles.head(part)) && ImageFiles.sha256(part).equals(hash);
            if (!isWhole) return refuse(part);
            boolean handed = hand(hash, part);
            part.delete();
            return handed ? "done" : "refused";
        } catch (IOException | RuntimeException unwritable) {
            return refuse(part);
        }
    }

    private static String refuse(File part) {
        if (part != null) part.delete();
        return "refused";
    }

    /**
     * Save an image copied or shared on this phone: `source` is copied in, so
     * the caller's file can go. The same picture as the newest unpinned item
     * bumps that one to the top, as a repeated text does. Returns the item's
     * id, or null when it isn't an image that is kept (its kind, or its size).
     */
    public String saveImage(File source, int width, int height, String sourceAppName, long dateCopied) {
        String id;
        synchronized (this) {
            String type;
            String hash;
            String name;
            long bytes = source.length();
            try {
                type = ImageFiles.typeOf(ImageFiles.head(source));
                if (type == null || bytes < 1 || bytes > SyncQueries.MAX_IMAGE_BYTES || width < 1 || height < 1) return null;
                hash = ImageFiles.sha256(source);
                name = images.keep(source, type);
            } catch (IOException unreadable) {
                return null;
            }
            String kept = name;
            String[] used = { null };
            id = inTransaction(() -> {
                try (
                    Cursor newest = db.rawQuery(
                        "SELECT id, kind, imageHash FROM CLIPBOARD_ITEMS WHERE deletedAt IS NULL AND pinnedAt IS NULL ORDER BY " +
                        HistoryQueries.UNPINNED_ORDER +
                        " LIMIT 1",
                        null
                    )
                ) {
                    if (newest.moveToFirst() && "image".equals(newest.getString(1)) && hash.equals(newest.getString(2))) {
                        String repeated = newest.getString(0);
                        db.execSQL(
                            "UPDATE CLIPBOARD_ITEMS SET dateCopied = MAX(dateCopied, ?), sourceAppName = ?, syncSeq = ? WHERE id = ?",
                            new Object[] { dateCopied, sourceAppName, nextSyncSeq(), repeated }
                        );
                        return repeated;
                    }
                }
                String newId = UUID.randomUUID().toString();
                ContentValues values = new ContentValues();
                values.put("id", newId);
                values.put("kind", "image");
                values.put("path", kept);
                values.put("imageSize", "{\"width\":" + width + ",\"height\":" + height + "}");
                values.put("imageHash", hash);
                values.put("imageBytes", bytes);
                values.put("imageType", type);
                values.put("dateCopied", dateCopied);
                values.put("sourceAppName", sourceAppName);
                values.put("createdAt", dateCopied);
                values.put("originDevice", deviceId);
                values.put("syncSeq", nextSyncSeq());
                db.insertOrThrow("CLIPBOARD_ITEMS", null, values);
                used[0] = kept;
                return newId;
            });
            // a repeat keeps the file it has
            if (used[0] == null) images.remove(kept);
            deleteBeyondLimits(System.currentTimeMillis());
        }
        notifyChanged();
        return id;
    }

    private void writePeer(String deviceId, Map<String, Object> patch) {
        db.execSQL(SyncQueries.CREATE_PEER, new Object[] { deviceId });
        if (patch.isEmpty()) return;
        List<String> fields = SyncQueries.peerFields(patch.keySet());
        Object[] values = new Object[fields.size() + 1];
        for (int i = 0; i < fields.size(); i++) values[i] = patch.get(fields.get(i));
        values[fields.size()] = deviceId;
        db.execSQL(SyncQueries.updatePeer(fields), values);
    }

    private static SyncRows.Row toSyncRow(Cursor row) {
        return new SyncRows.Row(
            string(row, "id"),
            string(row, "value"),
            longColumn(row, "dateCopied"),
            string(row, "sourceAppName"),
            string(row, "sourceAppBundleId"),
            nullableLong(row, "pinnedAt"),
            string(row, "pinnedStamp"),
            nullableLong(row, "deletedAt"),
            nullableLong(row, "createdAt"),
            string(row, "originDevice"),
            string(row, "secrets"),
            string(row, "linkUrl"),
            string(row, "linkHost"),
            nullableInt(row, "detectorVersion"),
            longColumn(row, "syncSeq"),
            string(row, "kind"),
            new SyncRows.Image(string(row, "imageSize"), string(row, "imageHash"), nullableLong(row, "imageBytes"), string(row, "imageType")),
            string(row, "color")
        );
    }

    // ---- helpers

    private interface Work<T> {
        T run();
    }

    private <T> T inTransaction(Work<T> work) {
        db.beginTransaction();
        try {
            T result = work.run();
            db.setTransactionSuccessful();
            return result;
        } finally {
            db.endTransaction();
        }
    }

    /** The syncSeq for a row about to be written: the counter only goes up */
    private long nextSyncSeq() {
        db.execSQL("UPDATE SYNC_META SET value = value + 1 WHERE key = 'seq'");
        return longQuery("SELECT value FROM SYNC_META WHERE key = 'seq'", Collections.emptyList());
    }

    private String metaString(String key) {
        try (Cursor row = db.rawQuery("SELECT value FROM SYNC_META WHERE key = ?", new String[] { key })) {
            if (!row.moveToFirst()) throw new IllegalStateException("SYNC_META has no " + key);
            return row.getString(0);
        }
    }

    private void writeState(String key, String value) {
        ContentValues values = new ContentValues();
        values.put("key", key);
        values.put("value", value);
        db.insertWithOnConflict("APP_STATE", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    private long longQuery(String sql, List<Object> values) {
        try (Cursor row = db.rawQuery(sql, args(values))) {
            return row.moveToFirst() ? row.getLong(0) : 0;
        }
    }

    /**
     * Android binds query values as strings only. Each number here is compared
     * with an INTEGER column, or is a LIMIT, so sqlite reads it back as a number.
     */
    private static String[] args(List<Object> values) {
        String[] strings = new String[values.size()];
        for (int i = 0; i < strings.length; i++) strings[i] = Objects.toString(values.get(i), null);
        return strings;
    }

    private Item toItem(Cursor row, List<SecretSpan> secrets, boolean preview) {
        String text = string(row, "value");
        boolean isTruncated = false;
        if (preview && text != null) {
            HistoryText.Preview cut = HistoryText.truncate(text, secrets, (int) longColumn(row, "valueLength"), HistoryText.PREVIEW_LENGTH);
            text = cut.text;
            secrets = cut.secrets;
            isTruncated = cut.isTruncated;
        }
        String linkUrl = string(row, "linkUrl");
        String linkHost = string(row, "linkHost");
        boolean hasLink = linkUrl != null && linkHost != null;
        return new Item(
            string(row, "id"),
            longColumn(row, "dateCopied"),
            text,
            string(row, "sourceAppName"),
            string(row, "sourceAppBundleId"),
            string(row, "originMaker"),
            nullableLong(row, "pinnedAt"),
            secrets,
            hasLink ? linkUrl : null,
            hasLink ? linkHost : null,
            isTruncated,
            nullableInt(row, "detectorVersion"),
            string(row, "kind"),
            images.file(string(row, "path")),
            string(row, "imageSize"),
            string(row, "color")
        );
    }

    private static String string(Cursor row, String column) {
        int index = row.getColumnIndexOrThrow(column);
        return row.isNull(index) ? null : row.getString(index);
    }

    private static long longColumn(Cursor row, String column) {
        return row.getLong(row.getColumnIndexOrThrow(column));
    }

    private static Integer nullableInt(Cursor row, String column) {
        int index = row.getColumnIndexOrThrow(column);
        return row.isNull(index) ? null : row.getInt(index);
    }

    private static Long nullableLong(Cursor row, String column) {
        int index = row.getColumnIndexOrThrow(column);
        return row.isNull(index) ? null : row.getLong(index);
    }

    /** As the Mac stores them: JSON of {start, end, label}, or NULL for none */
    static String serializeSecrets(List<SecretSpan> secrets) {
        if (secrets == null || secrets.isEmpty()) return null;
        JSONArray array = new JSONArray();
        try {
            for (SecretSpan secret : secrets) {
                array.put(new JSONObject().put("start", secret.start).put("end", secret.end).put("label", secret.label));
            }
        } catch (JSONException error) {
            throw new IllegalArgumentException(error);
        }
        return array.toString();
    }

    static List<SecretSpan> parseSecrets(String json) {
        if (json == null) return Collections.emptyList();
        List<SecretSpan> secrets = new ArrayList<>();
        try {
            JSONArray array = new JSONArray(json);
            for (int i = 0; i < array.length(); i++) {
                JSONObject span = array.optJSONObject(i);
                if (span == null) continue;
                Object start = span.opt("start");
                Object end = span.opt("end");
                Object label = span.opt("label");
                if (start instanceof Number && end instanceof Number && label instanceof String) {
                    secrets.add(new SecretSpan(((Number) start).intValue(), ((Number) end).intValue(), (String) label));
                }
            }
        } catch (JSONException ignored) {
            return Collections.emptyList();
        }
        return secrets;
    }

    static String sha256(String text) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder();
            for (byte b : hash) hex.append(String.format("%02x", b));
            return hex.toString();
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }
    }
}
