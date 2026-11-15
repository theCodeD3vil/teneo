package com.michael.teneo.sync;

import android.content.Context;
import android.util.Log;
import com.michael.teneo.history.HistoryStore;
import com.michael.teneo.history.SecretSpan;
import com.michael.teneo.history.SyncRows;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The phone's history, for the sync page: it can't open a database, so it
 * calls these through `TeneoNative` (apps/mobile/src/sync-service/native.ts
 * says what each one means) and HistoryStore answers. Everything is text:
 * every answer is `{"v": the value}`, or `{"error": why}`, and none of them
 * throws, so a failure reaches the page as something it can handle.
 *
 * The store is the app's own, shared by the app's web view and the share
 * screen, so a change made by either reaches the page (`localChanged`), and a
 * change the page saves reaches the app's list through the store's listeners.
 */
final class SyncStoreBridge {

    private static final String TAG = "TeneoSync";
    /** How much text one answer of changesAfter holds, about: the page asks again for the rest */
    private static final long MAX_CHARS_PER_ANSWER = 2L * 1024 * 1024;

    private final Context context;
    private final Runnable localChanged;
    private HistoryStore store;
    private HistoryStore.Listener listener;
    private boolean closed;

    /** `localChanged` runs, on any thread, after each change to the history */
    SyncStoreBridge(Context context, Runnable localChanged) {
        this.context = context.getApplicationContext();
        this.localChanged = localChanged;
    }

    private interface Call {
        Object run() throws JSONException;
    }

    /** The history, opened on first use. Opening can take a moment, so not on the main thread. */
    private HistoryStore store() {
        synchronized (this) {
            if (closed) throw new IllegalStateException("The page is gone");
            if (store != null) return store;
        }
        // Not under the lock: `close` runs on the main thread and must never
        // wait for a database to open
        HistoryStore opened = HistoryStore.get(context);
        synchronized (this) {
            if (closed) throw new IllegalStateException("The page is gone");
            if (store == null) {
                store = opened;
                listener = localChanged::run;
                store.addListener(listener);
            }
            return store;
        }
    }

    /** The page is gone: stop hearing of changes */
    synchronized void close() {
        closed = true;
        if (store != null) store.removeListener(listener);
        store = null;
    }

    private static String answer(Call call) {
        try {
            Object value = call.run();
            return new JSONObject().put("v", value == null ? JSONObject.NULL : value).toString();
        } catch (Throwable error) {
            Log.w(TAG, "a history call failed", error);
            try {
                return new JSONObject().put("error", String.valueOf(error)).toString();
            } catch (JSONException impossible) {
                return "{\"error\":\"failed\"}";
            }
        }
    }

    // ---- what the page may ask

    String deviceId() {
        return answer(() -> store().deviceId());
    }

    String epoch() {
        return answer(() -> store().syncEpoch());
    }

    String changesAfter(long after, int limit) {
        return answer(() -> json(store().syncChangesAfter(after, limit, MAX_CHARS_PER_ANSWER)));
    }

    String row(String id) {
        return answer(() -> json(store().syncRow(id)));
    }

    /** `skipped`: a JSON array of the ids to leave out */
    String newestUnpinned(String skipped) {
        return answer(() -> {
            JSONArray ids = new JSONArray(skipped);
            List<String> list = new ArrayList<>();
            for (int i = 0; i < ids.length(); i++) list.add(ids.getString(i));
            return json(store().syncNewestUnpinned(list));
        });
    }

    String peer(String deviceId) {
        return answer(() -> {
            SyncRows.Peer peer = store().syncPeer(deviceId);
            if (peer == null) return null;
            return new JSONObject()
                .put("deviceId", peer.deviceId)
                .put("name", peer.name)
                .put("platform", peer.platform)
                .put("epoch", orNull(peer.epoch))
                .put("receivedSeq", peer.receivedSeq)
                .put("lastAddress", orNull(peer.lastAddress))
                .put("lastSeenAt", peer.lastSeenAt);
        });
    }

    String latestStamp() {
        return answer(() -> store().syncLatestStamp());
    }

    /** `batch`: what one sync transaction wrote. The answer is false when it was not saved because the history changed since it was read. */
    String commit(String batch) {
        return answer(() -> store().syncApply(parseBatch(new JSONObject(batch))));
    }

    String trimHistory() {
        return answer(() -> {
            store().applyLimits(System.currentTimeMillis());
            return true;
        });
    }

    /** What the page's detection found in texts it read: `detections` is a JSON array of {id, secrets, link} */
    String saveDetections(String detections, int version) {
        return answer(() -> {
            JSONArray items = new JSONArray(detections);
            List<HistoryStore.Detection> found = new ArrayList<>();
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                JSONObject link = item.optJSONObject("link");
                List<SecretSpan> secrets = new ArrayList<>();
                JSONArray spans = item.optJSONArray("secrets");
                for (int s = 0; spans != null && s < spans.length(); s++) {
                    JSONObject span = spans.getJSONObject(s);
                    secrets.add(new SecretSpan(span.getInt("start"), span.getInt("end"), span.getString("label")));
                }
                found.add(
                    new HistoryStore.Detection(
                        item.getString("id"),
                        secrets,
                        link == null ? null : link.optString("url", null),
                        link == null ? null : link.optString("host", null)
                    )
                );
            }
            store().saveDetections(found, version);
            return true;
        });
    }

    /** A copy made on this phone, saved as the capture saves one. Only for a debug build to try sync with. */
    String debugSaveText(String text) {
        return answer(() -> store().saveText(new HistoryStore.NewText(text, null, null, Collections.emptyList(), null, null, null), System.currentTimeMillis()));
    }

    // ---- JSON

    private static Object orNull(Object value) {
        return value == null ? JSONObject.NULL : value;
    }

    private static JSONObject json(SyncRows.Row row) throws JSONException {
        return new JSONObject()
            .put("id", row.id)
            .put("value", orNull(row.value))
            .put("dateCopied", row.dateCopied)
            .put("sourceAppName", orNull(row.sourceAppName))
            .put("sourceAppBundleId", orNull(row.sourceAppBundleId))
            .put("pinnedAt", orNull(row.pinnedAt))
            .put("pinnedStamp", orNull(row.pinnedStamp))
            .put("deletedAt", orNull(row.deletedAt))
            .put("createdAt", orNull(row.createdAt))
            .put("originDevice", orNull(row.originDevice))
            .put("secrets", orNull(row.secrets))
            .put("linkUrl", orNull(row.linkUrl))
            .put("linkHost", orNull(row.linkHost))
            .put("detectorVersion", orNull(row.detectorVersion))
            .put("syncSeq", row.syncSeq);
    }

    private static JSONObject json(SyncRows.Single single) throws JSONException {
        return new JSONObject().put("row", single.row == null ? JSONObject.NULL : json(single.row)).put("head", single.head);
    }

    private static JSONObject json(SyncRows.Changes changes) throws JSONException {
        JSONArray rows = new JSONArray();
        for (SyncRows.Row row : changes.rows) rows.put(json(row));
        return new JSONObject().put("rows", rows).put("head", changes.head).put("capped", changes.capped);
    }

    private static String string(JSONObject object, String key) {
        return object.isNull(key) ? null : object.optString(key, null);
    }

    private static Long number(JSONObject object, String key) throws JSONException {
        return object.isNull(key) ? null : object.getLong(key);
    }

    private static SyncRows.Row parseRow(JSONObject row) throws JSONException {
        Long detector = number(row, "detectorVersion");
        return new SyncRows.Row(
            row.getString("id"),
            string(row, "value"),
            row.getLong("dateCopied"),
            string(row, "sourceAppName"),
            string(row, "sourceAppBundleId"),
            number(row, "pinnedAt"),
            string(row, "pinnedStamp"),
            number(row, "deletedAt"),
            number(row, "createdAt"),
            string(row, "originDevice"),
            string(row, "secrets"),
            string(row, "linkUrl"),
            string(row, "linkHost"),
            detector == null ? null : detector.intValue(),
            0
        );
    }

    private static SyncRows.Batch parseBatch(JSONObject batch) throws JSONException {
        List<SyncRows.Row> puts = new ArrayList<>();
        JSONArray rows = batch.getJSONArray("puts");
        for (int i = 0; i < rows.length(); i++) puts.add(parseRow(rows.getJSONObject(i)));

        Map<String, Map<String, Object>> peers = new LinkedHashMap<>();
        JSONObject devices = batch.getJSONObject("peers");
        Iterator<String> ids = devices.keys();
        while (ids.hasNext()) {
            String deviceId = ids.next();
            JSONObject patch = devices.getJSONObject(deviceId);
            Map<String, Object> fields = new HashMap<>();
            Iterator<String> names = patch.keys();
            while (names.hasNext()) {
                String name = names.next();
                // a null sets NULL; the store only takes the fields of a device
                fields.put(name, patch.isNull(name) ? null : patch.get(name));
            }
            peers.put(deviceId, fields);
        }
        return new SyncRows.Batch(number(batch, "expectedHead"), puts, peers);
    }
}
