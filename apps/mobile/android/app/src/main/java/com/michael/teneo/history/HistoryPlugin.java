package com.michael.teneo.history;

import android.content.pm.ApplicationInfo;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The history for the app's web view (src/client/native-client.ts). Capacitor
 * runs these methods one at a time, off the main thread.
 *
 * A debuggable build also opens throwaway databases, named by `database`, for
 * the client contract tests to run against without touching the history.
 */
@CapacitorPlugin(name = "History")
public class HistoryPlugin extends Plugin {

    private static final Pattern TEST_DATABASE = Pattern.compile("^contract-[a-z0-9-]{1,40}\\.sqlite$");

    // each open store's listener, by database name
    private final Map<String, HistoryStore> watched = new HashMap<>();
    private final Map<String, HistoryStore.Listener> listeners = new HashMap<>();

    // an icon the sync service saves shows on the cards that were waiting for it
    private final AppIcons.Listener iconsListener = () -> notifyListeners("appIconsChanged", new JSObject());

    @Override
    public void load() {
        AppIcons.addListener(iconsListener);
    }

    /**
     * The icons of the Mac apps with these `names`, each a png data: URL, by
     * name; an app with none is left out. They are for every database alike.
     */
    @PluginMethod
    public void appIcons(PluginCall call) {
        JSArray names = call.getArray("names");
        JSObject icons = new JSObject();
        if (names != null) {
            AppIcons saved = new AppIcons(new File(getContext().getFilesDir(), AppIcons.FOLDER));
            for (int i = 0; i < names.length(); i++) {
                String name = names.optString(i, null);
                byte[] png = name == null ? null : saved.read(name);
                if (png != null) icons.put(name, "data:image/png;base64," + Base64.encodeToString(png, Base64.NO_WRAP));
            }
        }
        JSObject result = new JSObject();
        result.put("icons", icons);
        call.resolve(result);
    }

    @PluginMethod
    public void list(PluginCall call) {
        HistoryStore store = store(call);
        if (store == null) return;
        JSObject cursorObject = call.getObject("cursor");
        HistoryQueries.ListCursor cursor = null;
        if (cursorObject != null) {
            if (!cursorObject.has("dateCopied") || cursorObject.optString("id", null) == null) {
                call.reject("The cursor is incomplete");
                return;
            }
            cursor = new HistoryQueries.ListCursor(
                cursorObject.isNull("pinnedAt") ? null : cursorObject.optLong("pinnedAt"),
                cursorObject.optLong("dateCopied"),
                cursorObject.optString("id")
            );
        }
        HistoryStore.Page page = store.list(call.getString("kind", "all"), call.getString("search", ""), cursor, call.getInt("limit", 50));
        JSArray items = new JSArray();
        for (HistoryStore.Item item : page.items) items.put(toJson(item));
        JSObject result = new JSObject();
        result.put("items", items);
        result.put("nextCursor", page.nextCursor == null ? JSONObject.NULL : toJson(page.nextCursor));
        result.put("total", page.total == null ? JSONObject.NULL : page.total);
        call.resolve(result);
    }

    @PluginMethod
    public void get(PluginCall call) {
        HistoryStore store = store(call);
        String id = required(call, "id");
        if (store == null || id == null) return;
        HistoryStore.Item item = store.getItem(id);
        JSObject result = new JSObject();
        result.put("item", item == null ? JSONObject.NULL : toJson(item));
        call.resolve(result);
    }

    @PluginMethod
    public void setPinned(PluginCall call) {
        HistoryStore store = store(call);
        String id = required(call, "id");
        if (store == null || id == null) return;
        store.setPinned(id, Boolean.TRUE.equals(call.getBoolean("pinned", false)));
        call.resolve();
    }

    @PluginMethod
    public void delete(PluginCall call) {
        HistoryStore store = store(call);
        String id = required(call, "id");
        if (store == null || id == null) return;
        store.deleteItem(id);
        call.resolve();
    }

    /** Put an item's whole text, or its image, on the clipboard; rejects if it isn't there */
    @PluginMethod
    public void copy(PluginCall call) {
        HistoryStore store = store(call);
        String id = required(call, "id");
        if (store == null || id == null) return;
        HistoryStore.Item item = store.getItem(id);
        if (item != null && "image".equals(item.kind)) {
            try {
                if (item.imageFile == null || !item.imageFile.isFile()) throw new IllegalStateException("The image is gone");
                ClipboardWriter.writeImage(getContext(), item.imageFile);
                call.resolve();
            } catch (RuntimeException error) {
                call.reject("Couldn't copy the image", error);
            }
            return;
        }
        if (item == null || item.text == null) {
            call.reject("This item has no text to copy");
            return;
        }
        write(call, store, item.text, !item.secrets.isEmpty());
    }

    @PluginMethod
    public void copyText(PluginCall call) {
        HistoryStore store = store(call);
        String text = call.getString("text");
        if (store == null) return;
        if (text == null) {
            call.reject("There is no text to copy");
            return;
        }
        write(call, store, text, false);
    }

    private void write(PluginCall call, HistoryStore store, String text, boolean sensitive) {
        try {
            ClipboardWriter.write(getContext(), store, text, sensitive);
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Couldn't put it on the clipboard", error);
        }
    }

    @PluginMethod
    public void getSettings(PluginCall call) {
        HistoryStore store = store(call);
        if (store == null) return;
        call.resolve(settingsResult(store.settings()));
    }

    @PluginMethod
    public void updateSettings(PluginCall call) {
        HistoryStore store = store(call);
        if (store == null) return;
        JSObject changes = call.getObject("changes", new JSObject());
        Map<String, Object> values = new HashMap<>();
        Iterator<String> keys = changes.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            values.put(key, changes.opt(key));
        }
        call.resolve(settingsResult(store.updateSettings(values)));
    }

    /**
     * Save a text with what was found in it. `dateCopied` is for the test
     * databases only, which need old copies; anything else is copied now.
     */
    @PluginMethod
    public void saveText(PluginCall call) {
        HistoryStore store = store(call);
        String text = call.getString("text");
        if (store == null) return;
        if (text == null || text.isEmpty()) {
            call.reject("There is no text to save");
            return;
        }
        List<SecretSpan> secrets = new ArrayList<>();
        try {
            JSArray spans = call.getArray("secrets", new JSArray());
            for (int i = 0; i < spans.length(); i++) {
                JSONObject span = spans.getJSONObject(i);
                int start = span.getInt("start");
                int end = span.getInt("end");
                if (start < 0 || end > text.length() || start >= end) throw new JSONException("A secret is outside the text");
                secrets.add(new SecretSpan(start, end, span.getString("label")));
            }
        } catch (JSONException error) {
            call.reject("The secrets are malformed", error);
            return;
        }
        JSObject link = call.getObject("link");
        long now = System.currentTimeMillis();
        // a small number arrives as an Integer, which getLong refuses
        JSObject data = call.getData();
        boolean dated = data.has("dateCopied") && !data.isNull("dateCopied") && isTestDatabase(call);
        long copiedAt = dated ? data.optLong("dateCopied", now) : now;
        String id = store.saveText(
            new HistoryStore.NewText(
                text,
                call.getString("sourceAppName"),
                call.getString("sourceAppBundleId"),
                secrets,
                link == null ? null : link.optString("url", null),
                link == null ? null : link.optString("host", null),
                call.getInt("detectorVersion")
            ),
            copiedAt
        );
        JSObject result = new JSObject();
        result.put("id", id);
        call.resolve(result);
    }

    /** Texts the app has to look for secrets and links in: see HistoryStore.undetected */
    @PluginMethod
    public void undetected(PluginCall call) {
        HistoryStore store = store(call);
        Integer version = call.getInt("detectorVersion");
        if (store == null) return;
        if (version == null) {
            call.reject("No detectorVersion was given");
            return;
        }
        JSArray items = new JSArray();
        for (HistoryStore.Undetected text : store.undetected(version, call.getInt("limit", 10))) {
            JSObject item = new JSObject();
            item.put("id", text.id);
            item.put("text", text.text);
            items.put(item);
        }
        JSObject result = new JSObject();
        result.put("items", items);
        call.resolve(result);
    }

    /** Store the secrets and link the app found in each text */
    @PluginMethod
    public void saveDetections(PluginCall call) {
        HistoryStore store = store(call);
        Integer version = call.getInt("detectorVersion");
        if (store == null) return;
        if (version == null) {
            call.reject("No detectorVersion was given");
            return;
        }
        List<HistoryStore.Detection> detections = new ArrayList<>();
        try {
            JSArray items = call.getArray("items", new JSArray());
            for (int i = 0; i < items.length(); i++) {
                JSONObject item = items.getJSONObject(i);
                JSONObject link = item.optJSONObject("link");
                detections.add(
                    new HistoryStore.Detection(
                        item.getString("id"),
                        parseSecrets(item.optJSONArray("secrets")),
                        link == null ? null : link.optString("url", null),
                        link == null ? null : link.optString("host", null),
                        item.isNull("color") ? null : item.optString("color", null)
                    )
                );
            }
            store.saveDetections(detections, version);
        } catch (JSONException | IllegalArgumentException error) {
            call.reject("The detections are malformed", error);
            return;
        }
        call.resolve();
    }

    private static List<SecretSpan> parseSecrets(JSONArray spans) throws JSONException {
        List<SecretSpan> secrets = new ArrayList<>();
        if (spans == null) return secrets;
        for (int i = 0; i < spans.length(); i++) {
            JSONObject span = spans.getJSONObject(i);
            secrets.add(new SecretSpan(span.getInt("start"), span.getInt("end"), span.getString("label")));
        }
        return secrets;
    }

    /** Delete a test database, so the next call opens it new */
    @PluginMethod
    public void resetTestDatabase(PluginCall call) {
        String name = call.getString("database");
        if (!isDebuggable() || name == null || !TEST_DATABASE.matcher(name).matches()) {
            call.reject("Only a test database can be reset");
            return;
        }
        // the old store is closed with its file; the next call watches the new one
        watched.remove(name);
        listeners.remove(name);
        HistoryStore.delete(getContext(), name);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        AppIcons.removeListener(iconsListener);
        // each store outlives the web view, and must not call into a gone one
        for (Map.Entry<String, HistoryStore> entry : watched.entrySet()) {
            entry.getValue().removeListener(listeners.get(entry.getKey()));
        }
        watched.clear();
        listeners.clear();
    }

    /** The store `call` is for, or null after rejecting it */
    private HistoryStore store(PluginCall call) {
        String name = call.getString("database");
        if (name == null) {
            name = HistoryDatabase.NAME;
        } else if (!isDebuggable() || !TEST_DATABASE.matcher(name).matches()) {
            call.reject("There is no such database");
            return null;
        }
        HistoryStore store;
        try {
            store = HistoryStore.get(getContext(), name);
        } catch (RuntimeException error) {
            call.reject("The history couldn't be opened", error);
            return null;
        }
        if (watched.get(name) != store) {
            String database = name;
            HistoryStore.Listener listener = () -> {
                JSObject event = new JSObject();
                event.put("database", database);
                notifyListeners("historyChanged", event);
            };
            store.addListener(listener);
            watched.put(name, store);
            listeners.put(name, listener);
        }
        return store;
    }

    private boolean isTestDatabase(PluginCall call) {
        return call.getString("database") != null && isDebuggable();
    }

    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static String required(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null) call.reject("No " + key + " was given");
        return value;
    }

    private static JSObject settingsResult(Map<String, Object> settings) {
        JSObject values = new JSObject();
        for (Map.Entry<String, Object> entry : settings.entrySet()) values.put(entry.getKey(), entry.getValue());
        JSObject result = new JSObject();
        result.put("settings", values);
        return result;
    }

    private static JSObject toJson(HistoryQueries.ListCursor cursor) {
        JSObject json = new JSObject();
        json.put("pinnedAt", cursor.pinnedAt == null ? JSONObject.NULL : cursor.pinnedAt);
        json.put("dateCopied", cursor.dateCopied);
        json.put("id", cursor.id);
        return json;
    }

    private static JSObject toJson(HistoryStore.Item item) {
        JSONArray secrets = new JSONArray();
        for (SecretSpan secret : item.secrets) {
            JSObject span = new JSObject();
            span.put("start", secret.start);
            span.put("end", secret.end);
            span.put("label", secret.label);
            secrets.put(span);
        }
        JSObject json = new JSObject();
        json.put("id", item.id);
        json.put("kind", item.kind);
        // an image: where its file is, and its width and height
        json.put("imagePath", item.imageFile == null ? JSONObject.NULL : item.imageFile.getAbsolutePath());
        Object imageSize = JSONObject.NULL;
        if (item.imageSize != null) {
            try {
                imageSize = new JSONObject(item.imageSize);
            } catch (JSONException unreadable) {
                // shown without its size
            }
        }
        json.put("imageSize", imageSize);
        json.put("color", orNull(item.color));
        json.put("dateCopied", item.dateCopied);
        json.put("text", orNull(item.text));
        json.put("sourceAppName", orNull(item.sourceAppName));
        json.put("sourceAppBundleId", orNull(item.sourceAppBundleId));
        json.put("originMaker", item.originMaker == null || item.originMaker.isEmpty() ? JSONObject.NULL : item.originMaker);
        json.put("pinned", item.pinnedAt != null);
        json.put("secrets", secrets);
        json.put("linkUrl", orNull(item.linkUrl));
        json.put("linkHost", orNull(item.linkHost));
        json.put("isTruncated", item.isTruncated);
        json.put("detectorVersion", item.detectorVersion == null ? JSONObject.NULL : item.detectorVersion);
        return json;
    }

    // JSONObject.put drops a key given null; the client wants it there as null
    private static Object orNull(Object value) {
        return value == null ? JSONObject.NULL : value;
    }
}
