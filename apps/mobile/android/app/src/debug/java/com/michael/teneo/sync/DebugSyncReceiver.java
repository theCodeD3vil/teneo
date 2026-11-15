package com.michael.teneo.sync;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

/**
 * Sync from adb, in debug builds only: its manifest entry is in the debug
 * manifest, held to android.permission.DUMP, which only the shell and the
 * system have. Pairing goes through the app as a typed code does, so the code
 * is checked by the same parsers; it is used at once if the app is open, or
 * when it next opens.
 *
 *   adb shell am broadcast -n com.michael.teneo.debug/com.michael.teneo.sync.DebugSyncReceiver \
 *     --es pair "<recovery code or teneo://pair link>"
 *   ... --ez unpair true     turn sync off and forget the key
 *   ... --es copy "text"     a copy made on this phone, to see it reach the others
 *   ... --ez dial false      from the next start of the page: only listen and
 *                            announce, never dial
 *   ... --ez crashPage true  kill the web views' process, as the system would
 */
public final class DebugSyncReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        SyncController controller = SyncController.get(context);
        String code = intent.getStringExtra("pair");
        if (code != null) {
            Log.i(SyncController.TAG, "debug: pairing from adb");
            controller.debugPair(code);
        }
        if (intent.getBooleanExtra("unpair", false)) controller.unpair();
        if (intent.hasExtra("copy") || intent.hasExtra("dial") || intent.hasExtra("crashPage")) controller.debugCommand(intent);
    }
}
