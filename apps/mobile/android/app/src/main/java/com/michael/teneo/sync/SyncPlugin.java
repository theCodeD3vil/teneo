package com.michael.teneo.sync;

import android.Manifest;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.Arrays;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sync for the app's web view (src/client/native-sync.ts): pairing with a key
 * the app has already checked with the sync core's parsers, unpairing, and
 * the status, which SyncController keeps.
 */
@CapacitorPlugin(
    name = "Sync",
    permissions = { @Permission(alias = SyncPlugin.NOTIFICATIONS, strings = { Manifest.permission.POST_NOTIFICATIONS }) }
)
public class SyncPlugin extends Plugin {

    static final String NOTIFICATIONS = "notifications";

    private SyncController controller;

    private final SyncController.Listener listener = new SyncController.Listener() {
        @Override
        public void statusChanged(JSONObject status) {
            notifyListeners("statusChanged", toJs(status));
        }

        @Override
        public void debugPair(String code) {
            if (!isDebuggable()) return;
            JSObject event = new JSObject();
            event.put("code", code);
            // kept until the app listens: it may still be loading
            notifyListeners("debugPair", event, true);
        }
    };

    @Override
    public void load() {
        controller = SyncController.get(getContext());
        controller.addListener(listener);
    }

    @Override
    protected void handleOnDestroy() {
        controller.removeListener(listener);
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(toJs(controller.status()));
    }

    /**
     * Keep the vault key (`vaultKey`, base64) and start sync. With
     * `pairingAddresses`, `vaultKey` is a pairing code's one-time key, and the
     * vault's is fetched from the Mac at those host:port addresses.
     */
    @PluginMethod
    public void pair(PluginCall call) {
        String encoded = call.getString("vaultKey");
        com.getcapacitor.JSArray addresses = call.getArray("pairingAddresses", null);
        byte[] key;
        try {
            key = encoded == null ? null : Base64.decode(encoded, Base64.NO_WRAP);
        } catch (IllegalArgumentException malformed) {
            key = null;
        }
        if (key == null || key.length != VaultKeyStore.KEY_LENGTH) {
            call.reject("That isn't a sync key");
            return;
        }
        String error = controller.pair(key, addresses == null ? null : addresses.toString());
        Arrays.fill(key, (byte) 0);
        if (error != null) {
            call.reject(error);
            return;
        }
        call.resolve(toJs(controller.status()));
    }

    @PluginMethod
    public void unpair(PluginCall call) {
        controller.unpair();
        call.resolve(toJs(controller.status()));
    }

    /** A setting sync reads was saved */
    @PluginMethod
    public void settingsChanged(PluginCall call) {
        controller.settingsChanged();
        call.resolve();
    }

    /** Ask for the notification the background service shows. Resolves with `granted`. */
    @PluginMethod
    public void requestNotifications(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED) {
            answerNotifications(call);
            return;
        }
        requestPermissionForAlias(NOTIFICATIONS, call, "answerNotifications");
    }

    @PermissionCallback
    private void answerNotifications(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", Build.VERSION.SDK_INT < 33 || getPermissionState(NOTIFICATIONS) == PermissionState.GRANTED);
        call.resolve(result);
    }

    private boolean isDebuggable() {
        return (getContext().getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    private static JSObject toJs(JSONObject json) {
        try {
            return JSObject.fromJSONObject(json);
        } catch (JSONException impossible) {
            throw new IllegalStateException(impossible);
        }
    }
}
