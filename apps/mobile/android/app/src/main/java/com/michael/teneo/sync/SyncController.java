package com.michael.teneo.sync;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import com.michael.teneo.history.HistoryStore;
import com.michael.teneo.history.Settings;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sync on this phone as the app sees it, one for the process: whether it is
 * paired, whether the service should run (SyncRules), and what the service
 * last said. The app's plugin (SyncPlugin), the service, the activity and the
 * boot receiver all go through it.
 */
public final class SyncController {

    public interface Listener {
        void statusChanged(JSONObject status);

        /** A debug build was given a code to pair with from adb */
        default void debugPair(String code) {}
    }

    /** What the running service can be told */
    interface Running {
        void settingsChanged();

        void debugCommand(Intent command);
    }

    static final String TAG = "TeneoSync";
    static final String BACKGROUND_RECEIVE = "backgroundReceive";
    static final String SYNC_SECRETS = "syncSecrets";
    // the same defaults as src/types/settings.ts, for before the app has saved them
    static final boolean DEFAULT_BACKGROUND_RECEIVE = true;
    static final boolean DEFAULT_SYNC_SECRETS = false;

    private static final String PREFERENCES = "teneo-sync";
    private static final String DEVICES = "devices";

    private static SyncController instance;

    private final Context context;
    private final SharedPreferences preferences;
    private final VaultKeyStore keys;
    private final List<Listener> listeners = new CopyOnWriteArrayList<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    // guarded by `this`
    private final KnownDevices devices;
    private boolean appVisible;
    private boolean running;
    private String problem;
    private Running service;
    private String pendingDebugCode;

    // The two settings sync goes by, read from the database when the app
    // starts and when it says they changed, never on the way to deciding
    // whether the service runs: that is asked on the main thread
    private volatile boolean backgroundReceiveSetting = DEFAULT_BACKGROUND_RECEIVE;
    private volatile boolean syncSecretsSetting = DEFAULT_SYNC_SECRETS;

    public static synchronized SyncController get(Context context) {
        if (instance == null) instance = new SyncController(context.getApplicationContext());
        return instance;
    }

    private SyncController(Context context) {
        this.context = context;
        preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        keys = new VaultKeyStore(new PreferenceStorage(preferences), new KeystoreCipher());
        devices = new KnownDevices(readDevices());
        migrate();
        readSettings();
    }

    private void readSettings() {
        try {
            Map<String, Object> settings = HistoryStore.get(context).settings();
            backgroundReceiveSetting = Settings.bool(settings, BACKGROUND_RECEIVE, DEFAULT_BACKGROUND_RECEIVE);
            syncSecretsSetting = Settings.bool(settings, SYNC_SECRETS, DEFAULT_SYNC_SECRETS);
        } catch (RuntimeException unreadable) {
            Log.w(TAG, "could not read the settings", unreadable);
        }
    }

    private void migrate() {
        SyncMigrations.Flags flags = new SyncMigrations.Flags() {
            @Override
            public boolean isDone(String name) {
                return preferences.getBoolean(name, false);
            }

            @Override
            public void markDone(String name) {
                preferences.edit().putBoolean(name, true).commit();
            }
        };
        SyncMigrations.SavedSettings settings = new SyncMigrations.SavedSettings() {
            @Override
            public Map<String, Object> read() {
                return HistoryStore.get(context).settings();
            }

            @Override
            public void write(Map<String, Object> changes) {
                HistoryStore.get(context).updateSettings(changes);
            }
        };
        try {
            SyncMigrations.run(flags, settings);
        } catch (RuntimeException failed) {
            Log.w(TAG, "could not update the settings an earlier version saved; trying again next start", failed);
        }
    }

    // --- what the app asks

    public synchronized boolean isPaired() {
        return keys.has();
    }

    /** Keep the key and start sync. The error to show, or null when it worked. */
    public String pair(byte[] vaultKey) {
        synchronized (this) {
            if (keys.has()) return "This phone already syncs. Turn sync off before joining again.";
            if (!keys.save(vaultKey)) {
                return "Teneo couldn't keep the sync key safely on this phone.";
            }
            devices.clear();
            saveDevices();
            problem = null;
        }
        Log.i(TAG, "paired");
        apply();
        notifyStatus();
        return null;
    }

    /** Stop sync, and forget the key and the devices. The history stays. */
    public void unpair() {
        synchronized (this) {
            keys.forget();
            devices.clear();
            saveDevices();
            problem = null;
        }
        Log.i(TAG, "unpaired: the key and the known devices are forgotten");
        context.stopService(new Intent(context, SyncService.class));
        notifyStatus();
    }

    /** A setting that sync reads changed: start, stop or tell the service */
    public void settingsChanged() {
        boolean secretsWereAllowed = syncSecretsSetting;
        readSettings();
        if (!secretsWereAllowed && syncSecretsSetting) {
            // The items with secrets were held back, and the other devices have
            // read past them. A new change number each is what sends them now,
            // whether or not sync is running at this moment.
            try {
                int restamped = HistoryStore.get(context).restampSecretItems();
                Log.i(TAG, "items with secrets may sync now: " + restamped + " to send");
            } catch (RuntimeException failed) {
                Log.w(TAG, "could not mark the items with secrets to be sent", failed);
            }
        }
        Running current;
        synchronized (this) {
            current = service;
        }
        if (current != null) main.post(current::settingsChanged);
        apply();
        notifyStatus();
    }

    public void setAppVisible(boolean visible) {
        synchronized (this) {
            if (appVisible == visible) return;
            appVisible = visible;
        }
        apply();
    }

    public synchronized JSONObject status() {
        JSONObject status = new JSONObject();
        try {
            status.put("paired", keys.has());
            status.put("running", running);
            status.put("problem", problem == null ? JSONObject.NULL : problem);
            JSONArray list = new JSONArray();
            if (keys.has()) {
                for (KnownDevices.Device device : devices.list()) list.put(toJson(device, true));
            }
            status.put("devices", list);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        return status;
    }

    public void addListener(Listener listener) {
        listeners.add(listener);
        String code;
        synchronized (this) {
            code = pendingDebugCode;
            pendingDebugCode = null;
        }
        if (code != null) listener.debugPair(code);
    }

    public void removeListener(Listener listener) {
        listeners.remove(listener);
    }

    // --- whether the service runs

    synchronized SyncRules.Mode mode() {
        return SyncRules.mode(keys.has(), backgroundReceive(), appVisible);
    }

    /** Start or stop the service to match the rules */
    public void apply() {
        SyncRules.Mode mode;
        boolean visible;
        synchronized (this) {
            mode = mode();
            visible = appVisible;
        }
        Intent intent = new Intent(context, SyncService.class);
        try {
            if (mode == SyncRules.Mode.OFF) {
                context.stopService(intent);
            } else if (mode == SyncRules.Mode.BACKGROUND && !visible) {
                // with no window on screen only a foreground service may start
                intent.putExtra(SyncService.EXTRA_FOREGROUND, true);
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (RuntimeException refused) {
            // not allowed to start a service right now; the next open of the app tries again
            Log.w(TAG, "could not " + (mode == SyncRules.Mode.OFF ? "stop" : "start") + " the sync service", refused);
            // said, not only logged: otherwise the Sync tab goes on saying it is looking for devices
            if (mode != SyncRules.Mode.OFF) problem("Android didn't let sync start. Open Teneo to start it.");
        }
    }

    boolean backgroundReceive() {
        return backgroundReceiveSetting;
    }

    boolean syncSecrets() {
        return syncSecretsSetting;
    }

    // --- what the service says

    /** The key, or null with the problem set when there is none to use */
    byte[] vaultKey() {
        VaultKeyStore.Read read;
        synchronized (this) {
            read = keys.read();
            if (read.unreadable) problem = "Teneo can't read its sync key. Turn sync off, then join again.";
        }
        if (read.unreadable) {
            Log.e(TAG, "the stored sync key can't be read");
            notifyStatus();
        }
        return read.key;
    }

    void serviceAttached(Running running) {
        synchronized (this) {
            service = running;
        }
    }

    void serviceDetached(Running running) {
        synchronized (this) {
            if (service == running) service = null;
        }
    }

    void running(boolean isRunning) {
        synchronized (this) {
            if (running == isRunning) return;
            running = isRunning;
            if (isRunning) problem = null;
            else if (devices.allGone(System.currentTimeMillis())) saveDevices();
        }
        notifyStatus();
    }

    void peersChanged(List<KnownDevices.Peer> peers) {
        synchronized (this) {
            if (!devices.connected(peers, System.currentTimeMillis())) return;
            saveDevices();
        }
        notifyStatus();
    }

    void problem(String text) {
        synchronized (this) {
            problem = text;
        }
        notifyStatus();
    }

    // --- debug builds: from DebugSyncReceiver

    void debugPair(String code) {
        if (listeners.isEmpty()) {
            synchronized (this) {
                pendingDebugCode = code;
            }
            Log.i(TAG, "debug: the code is used when the app is next open");
            return;
        }
        for (Listener listener : listeners) listener.debugPair(code);
    }

    void debugCommand(Intent command) {
        Running current;
        synchronized (this) {
            current = service;
        }
        if (current == null) {
            Log.w(TAG, "debug: sync isn't running");
            return;
        }
        main.post(() -> current.debugCommand(command));
    }

    // --- the parts

    private void notifyStatus() {
        JSONObject status = status();
        for (Listener listener : listeners) {
            try {
                listener.statusChanged(status);
            } catch (RuntimeException ignored) {
                // one listener's trouble is not the others'
            }
        }
    }

    private List<KnownDevices.Device> readDevices() {
        List<KnownDevices.Device> stored = new ArrayList<>();
        String saved = preferences.getString(DEVICES, null);
        if (saved == null) return stored;
        try {
            JSONArray list = new JSONArray(saved);
            for (int i = 0; i < list.length(); i++) {
                JSONObject device = list.getJSONObject(i);
                stored.add(
                    new KnownDevices.Device(
                        device.getString("id"),
                        device.optString("name", ""),
                        device.optString("platform", ""),
                        device.optLong("lastSeen", 0),
                        false
                    )
                );
            }
        } catch (JSONException malformed) {
            Log.w(TAG, "the known devices are unreadable: starting over");
        }
        return stored;
    }

    // guarded by `this`
    private void saveDevices() {
        JSONArray list = new JSONArray();
        try {
            for (KnownDevices.Device device : devices.list()) list.put(toJson(device, false));
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
        preferences.edit().putString(DEVICES, list.toString()).apply();
    }

    private static JSONObject toJson(KnownDevices.Device device, boolean withConnected) throws JSONException {
        JSONObject json = new JSONObject();
        json.put("id", device.id);
        json.put("name", device.name);
        json.put("platform", device.platform);
        json.put("lastSeen", device.lastSeen);
        if (withConnected) json.put("connected", device.connected);
        return json;
    }

    /** The key's storage: this app's private preferences, which no backup includes */
    private static final class PreferenceStorage implements VaultKeyStore.Storage {

        private final SharedPreferences preferences;

        PreferenceStorage(SharedPreferences preferences) {
            this.preferences = preferences;
        }

        @Override
        public String get(String name) {
            return preferences.getString(name, null);
        }

        @Override
        public boolean put(String name, String value) {
            return preferences.edit().putString(name, value).commit();
        }

        @Override
        public boolean remove(String name) {
            return preferences.edit().remove(name).commit();
        }
    }
}
