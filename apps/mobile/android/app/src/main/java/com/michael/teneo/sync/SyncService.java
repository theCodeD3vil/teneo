package com.michael.teneo.sync;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.util.Log;
import com.michael.teneo.R;

/**
 * Keeps clipboard sync running with the app closed and the screen off: a
 * foreground service with a permanent, quiet notification that owns a
 * SyncRuntime (a window-less web view running the sync core, plus the sockets
 * and Bonjour it needs).
 *
 * Where the recovery code comes from is the subclass's business, so this class
 * does not decide how keys are kept. Nothing in a release build starts it yet:
 * its only subclass is a debug one, and the manifest entry is in the debug
 * manifest too.
 *
 * It is restarted by the system when it is killed (START_STICKY, with no
 * intent), and rebuilds the runtime when the web view's process dies, waiting
 * longer each time it happens in a row and giving up after a few.
 */
public abstract class SyncService extends Service implements SyncRuntime.Host {

    private static final String TAG = "TeneoSync";
    private static final String CHANNEL_ID = "sync";
    private static final int NOTIFICATION_ID = 1;

    /** A web view that dies again and again is not worth restarting forever */
    private static final int MAX_QUICK_DEATHS = 5;
    /** A runtime that lived this long was not a crash loop */
    private static final long STABLE_MS = 60_000;
    private static final long FIRST_RESTART_DELAY_MS = 1_000;
    private static final long MAX_RESTART_DELAY_MS = 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SyncRuntime runtime;
    private int quickDeaths;
    private boolean destroyed;

    /**
     * The recovery code to sync with: the one in `intent`, or from wherever
     * the subclass keeps it when `intent` is null (the system restarted the
     * service). Null when there is none, which ends the service.
     */
    protected abstract String recoveryCode(Intent intent);

    /** Whether to dial the devices Bonjour finds, as well as listening for them */
    protected boolean dialOut() {
        return true;
    }

    /** Whether sync is running in this service */
    protected final boolean isRunning() {
        return runtime != null;
    }

    /** Runs script in the sync page, if it is up. For the debug starter. */
    protected final void runInPage(String script) {
        if (runtime != null) runtime.evaluate(script);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager notifications = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.sync_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.sync_channel_description));
        channel.setShowBadge(false);
        notifications.createNotificationChannel(channel);
        if (!notifications.areNotificationsEnabled()) {
            // the service still runs; the system just doesn't show why
            Log.w(TAG, "notifications are off for Teneo, so the sync notification is hidden");
        }

        try {
            startForeground(NOTIFICATION_ID, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
        } catch (RuntimeException refused) {
            // not allowed to be a foreground service right now, or missing a permission
            Log.e(TAG, "could not start as a foreground service", refused);
            stopSelf();
        }
    }

    private Notification notification() {
        Notification.Builder builder = new Notification.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_sync)
            .setContentTitle(getString(R.string.sync_notification_title))
            .setContentText(getString(R.string.sync_notification_text))
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false);
        // tapping it opens the app
        Intent launch = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (launch != null) {
            builder.setContentIntent(PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE));
        }
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (runtime != null) return START_STICKY; // already running
        String code = recoveryCode(intent);
        if (code == null) {
            Log.i(TAG, intent == null ? "restarted by the system with nothing to start sync with: stopping" : "started with no recovery code: stopping");
            stopSelf();
            return START_NOT_STICKY;
        }
        begin(code);
        return START_STICKY;
    }

    private void begin(String code) {
        Log.i(TAG, "starting sync");
        runtime = new SyncRuntime(this, this, code, dialOut());
        runtime.start();
    }

    // --- what the runtime tells us

    @Override
    public void failed(String reason) {
        Log.e(TAG, "sync can't run: " + reason);
        stopSelf();
    }

    @Override
    public void pageGone(boolean crashed) {
        SyncRuntime dead = runtime;
        runtime = null;
        if (destroyed || dead == null) return;
        quickDeaths = dead.ageMs() >= STABLE_MS ? 1 : quickDeaths + 1;
        if (quickDeaths > MAX_QUICK_DEATHS) {
            Log.e(TAG, "the sync page keeps dying: giving up");
            stopSelf();
            return;
        }
        long delay = Math.min(MAX_RESTART_DELAY_MS, FIRST_RESTART_DELAY_MS << (quickDeaths - 1));
        Log.i(TAG, "restarting the sync page in " + delay + " ms (death " + quickDeaths + ")");
        main.postDelayed(this::restart, delay);
    }

    private void restart() {
        if (destroyed || runtime != null) return;
        String code = recoveryCode(null);
        if (code == null) {
            Log.w(TAG, "nothing to restart sync with: stopping");
            stopSelf();
            return;
        }
        begin(code);
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // swiping the app away from the recent apps does not stop a foreground
        // service, and sync is meant to outlive the app's window
        Log.i(TAG, "the app's task was removed; sync keeps running");
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        if (runtime != null) runtime.stop();
        runtime = null;
        super.onDestroy();
    }
}
