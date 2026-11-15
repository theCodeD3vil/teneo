package com.michael.teneo.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Brings sync back after a reboot or an update of the app, without the app
 * being opened: only when it is paired and receives in the background. The
 * key is read from storage by the service, as on every start.
 */
public final class SyncBootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action) && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;
        SyncController controller = SyncController.get(context);
        if (!SyncRules.startsUnattended(controller.isPaired(), controller.backgroundReceive())) {
            Log.i(SyncController.TAG, "not starting sync after " + action + ": it isn't on in the background");
            return;
        }
        Log.i(SyncController.TAG, "starting sync after " + action);
        controller.apply();
    }
}
