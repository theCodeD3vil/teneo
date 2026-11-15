package com.michael.teneo.history;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's clipboard history, as the Mac's database.ts keeps it: one store
 * per database file, shared by everything in the app process (the web view's
 * plugin now; the share screen and a sync service later). Each method is one
 * transaction, and one runs at a time.
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
        public final Long pinnedAt;
        public final List<SecretSpan> secrets;
        public final String linkUrl;
        public final String linkHost;
        public final boolean isTruncated;

        Item(
            String id,
            long dateCopied,
            String text,
            String sourceAppName,
            String sourceAppBundleId,
            Long pinnedAt,
            List<SecretSpan> secrets,
            String linkUrl,
            String linkHost,
            boolean isTruncated
        ) {
            this.id = id;
            this.dateCopied = dateCopied;
            this.text = text;
            this.sourceAppName = sourceAppName;
            this.sourceAppBundleId = sourceAppBundleId;
            this.pinnedAt = pinnedAt;
            this.secrets = secrets;
            this.linkUrl = linkUrl;
            this.linkHost = linkHost;
            this.isTruncated = isTruncated;
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
    private static final String LAST_SEEN_CLIP = "lastSeenClip";

    // A text holding a secret is read whole, so the search can tell the
    // secret from the rest; any other only as far as the list shows it
    private static final String LIST_COLUMNS =
        "id, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, secrets, linkUrl, linkHost, " +
        "CASE WHEN secrets IS NOT NULL THEN value ELSE substr(value, 1, " +
        HistoryText.PREVIEW_LENGTH +
        ") END AS value, length(value) AS valueLength";
    private static final String ITEM_COLUMNS =
        "id, dateCopied, sourceAppName, sourceAppBundleId, pinnedAt, secrets, linkUrl, linkHost, value, length(value) AS valueLength";

    private static final Map<String, HistoryStore> stores = new HashMap<>();

    private final HistoryDatabase helper;
    private final SQLiteDatabase db;
    private final Hlc clock;
    private final String deviceId;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();

    private HistoryStore(HistoryDatabase helper) {
        this.helper = helper;
        db = helper.getWritableDatabase();
        deviceId = metaString("deviceId");
        clock = new Hlc(deviceId, System::currentTimeMillis);
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
            store = new HistoryStore(new HistoryDatabase(context.getApplicationContext(), name));
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
        List<Item> items = new ArrayList<>();
        HistoryQueries.ListCursor after = cursor;
        boolean exhausted = false;

        while (items.size() < wanted && !exhausted) {
            int batchSize = Math.max(wanted - items.size(), 20);
            HistoryQueries.Condition where = HistoryQueries.listConditions(kind, query, after);
            List<Object> values = new ArrayList<>(where.values);
            values.add(batchSize);
            String sql =
                "SELECT " +
                LIST_COLUMNS +
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
                    if (!query.isEmpty() && !secrets.isEmpty()) {
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
        HistoryQueries.Condition where = HistoryQueries.listConditions(kind, query, null);
        if (query.isEmpty()) {
            return (int) longQuery("SELECT COUNT(*) FROM CLIPBOARD_ITEMS WHERE " + where.sql, where.values);
        }
        long count = longQuery("SELECT COUNT(*) FROM CLIPBOARD_ITEMS WHERE " + where.sql + " AND secrets IS NULL", where.values);
        String sql = "SELECT value, secrets, sourceAppName, linkHost FROM CLIPBOARD_ITEMS WHERE " + where.sql + " AND secrets IS NOT NULL";
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
            changed = inTransaction(() -> {
                ContentValues values = new ContentValues();
                values.put("deletedAt", System.currentTimeMillis());
                values.putNull("pinnedAt");
                values.put("syncSeq", nextSyncSeq());
                for (String column : new String[] { "value", "secrets", "linkUrl", "linkHost", "encrypted" }) {
                    values.putNull(column);
                }
                return db.update("CLIPBOARD_ITEMS", values, "id = ? AND deletedAt IS NULL", new String[] { id }) > 0;
            });
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
                    ContentValues values = new ContentValues();
                    values.put("dateCopied", dateCopied);
                    values.put("sourceAppName", copy.sourceAppName);
                    values.put("sourceAppBundleId", copy.sourceAppBundleId);
                    values.put("syncSeq", nextSyncSeq());
                    db.update("CLIPBOARD_ITEMS", values, "id = ?", new String[] { repeated });
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
        return inTransaction(() -> {
            int deleted = 0;
            if (HistoryQueries.limitsHistory(copiedBefore, keepNewest)) {
                Object[] values = HistoryQueries.deletionValues(now, copiedBefore, keepNewest);
                deleted += db.delete("CLIPBOARD_ITEMS", HistoryQueries.DELETION_CONDITION, args(java.util.Arrays.asList(values)));
            }
            // these are already out of the list: deleting them changes nothing shown
            db.delete(
                "CLIPBOARD_ITEMS",
                HistoryQueries.TOMBSTONE_ROW + " AND deletedAt < ?",
                new String[] { String.valueOf(now - HistoryQueries.TOMBSTONE_LIFETIME_MS) }
            );
            return deleted > 0;
        });
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
    }

    /** Whether `text` is what Teneo last put on the clipboard */
    public synchronized boolean isWrittenClip(String text) {
        try (Cursor row = db.rawQuery("SELECT value FROM APP_STATE WHERE key = ?", new String[] { LAST_WRITTEN_CLIP })) {
            return row.moveToFirst() && row.getString(0).equals(sha256(text));
        }
    }

    /** The time of the last clip the capture read, 0 for none */
    public synchronized long seenClip() {
        try (Cursor row = db.rawQuery("SELECT value FROM APP_STATE WHERE key = ?", new String[] { LAST_SEEN_CLIP })) {
            if (!row.moveToFirst()) return 0;
            try {
                return Long.parseLong(row.getString(0));
            } catch (NumberFormatException ignored) {
                return 0;
            }
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

        public Detection(String id, List<SecretSpan> secrets, String linkUrl, String linkHost) {
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
     * alone. Throws, saving none, if a secret lies outside its text.
     */
    public void saveDetections(List<Detection> detections, int version) {
        boolean changed;
        synchronized (this) {
            changed = inTransaction(() -> {
                boolean any = false;
                for (Detection found : detections) {
                    String text = null;
                    try (Cursor row = db.rawQuery("SELECT value FROM CLIPBOARD_ITEMS WHERE id = ?", new String[] { found.id })) {
                        if (row.moveToFirst() && !row.isNull(0)) text = row.getString(0);
                    }
                    if (text == null) continue;
                    for (SecretSpan secret : found.secrets) {
                        if (secret.start < 0 || secret.end > text.length() || secret.start >= secret.end) {
                            throw new IllegalArgumentException("A secret is outside the text");
                        }
                    }
                    boolean hasLink = found.linkUrl != null && found.linkHost != null;
                    ContentValues values = new ContentValues();
                    values.put("secrets", serializeSecrets(found.secrets));
                    values.put("linkUrl", hasLink ? found.linkUrl : null);
                    values.put("linkHost", hasLink ? found.linkHost : null);
                    values.put("detectorVersion", version);
                    any |= db.update("CLIPBOARD_ITEMS", values, "id = ?", new String[] { found.id }) > 0;
                }
                return any;
            });
        }
        if (changed) notifyChanged();
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

    private static Item toItem(Cursor row, List<SecretSpan> secrets, boolean preview) {
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
            nullableLong(row, "pinnedAt"),
            secrets,
            hasLink ? linkUrl : null,
            hasLink ? linkHost : null,
            isTruncated
        );
    }

    private static String string(Cursor row, String column) {
        int index = row.getColumnIndexOrThrow(column);
        return row.isNull(index) ? null : row.getString(index);
    }

    private static long longColumn(Cursor row, String column) {
        return row.getLong(row.getColumnIndexOrThrow(column));
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
