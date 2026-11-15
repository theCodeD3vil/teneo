package com.michael.teneo.sync;

import android.content.Intent;
import android.util.Log;
import org.json.JSONObject;

/**
 * The only way to start sync for now, and only in debug builds: its manifest
 * entry is in the debug manifest, so a release build has no service to start.
 * Only `adb shell` may start it (see the permission in the manifest).
 *
 *   adb shell am start-foreground-service \
 *     -n com.michael.teneo/.sync.DebugSyncService --es code "<recovery code>"
 *   ... --es copy "text"     a copy made on this phone, to see it reach the others
 *   ... --ez dial false      only listen and announce, never dial: how a phone
 *                            behaves on a network where the others can't be reached
 *   ... --ez stop true       stop sync
 *
 * A recovery code comes from `bun backend/sync/new-recovery-code.ts` in
 * apps/desktop. It is kept in memory only: a restart of the whole process
 * (not of the service) forgets it, and sync stops until it is given again.
 */
public final class DebugSyncService extends SyncService {

    private static final String TAG = "TeneoSync";

    private static String code;
    private static boolean dial = true;

    @Override
    protected String recoveryCode(Intent intent) {
        if (intent != null && intent.hasExtra("code")) code = intent.getStringExtra("code");
        if (intent != null && intent.hasExtra("dial")) dial = intent.getBooleanExtra("dial", true);
        return code;
    }

    @Override
    protected boolean dialOut() {
        return dial;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && intent.getBooleanExtra("stop", false)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        String copy = intent == null ? null : intent.getStringExtra("copy");
        if (copy != null) {
            if (!isRunning()) {
                // this command created the service: don't leave it up with nothing running
                Log.w(TAG, "sync isn't running, so there is nowhere to copy to: start it with --es code first");
                stopSelf();
                return START_NOT_STICKY;
            }
            runInPage("teneoSyncPage.debug.copy(" + JSONObject.quote(copy) + ")");
            return START_STICKY;
        }
        if (isRunning() && intent != null && intent.hasExtra("dial") && intent.getBooleanExtra("dial", true) != dial) {
            Log.w(TAG, "--ez dial is read when sync starts: stop it (--ez stop true) and start it again");
        }
        return super.onStartCommand(intent, flags, startId);
    }
}
