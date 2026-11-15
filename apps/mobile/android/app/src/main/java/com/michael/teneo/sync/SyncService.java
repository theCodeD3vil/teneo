package com.michael.teneo.sync;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.service.notification.StatusBarNotification;
import android.util.Base64;
import android.util.Log;
import com.michael.teneo.Notifications;
import com.michael.teneo.R;
import java.util.Arrays;
import java.util.List;

/**
 * Runs clipboard sync: owns a SyncRuntime (a window-less web view running the
 * sync core, plus the sockets and Bonjour it needs). SyncController starts and
 * stops it by the rules in SyncRules, and it checks them again itself on every
 * start, so a start that comes late (from the system, after a reboot) never
 * runs sync that should be off.
 *
 * With background receive on it is a foreground service with a quiet,
 * permanent notification: it outlives the app, is restarted by the system
 * when it is killed (START_STICKY, with no intent), and reads the key from
 * storage each time it starts. With it off it runs only while the app is on
 * screen, with no notification.
 *
 * Android lets the user swipe the notification away, so it is put back when
 * that happens. And Android may refuse a start that comes with no window on
 * screen: then a notice that sync is paused takes the notification's place,
 * and a tap on it opens the app, which starts sync.
 *
 * It rebuilds the runtime when the web view's process dies, waiting longer
 * each time it happens in a row and giving up after a few.
 */
public final class SyncService extends Service implements SyncRuntime.Host, SyncController.Running {

    /** Started with startForegroundService, so startForeground must follow */
    static final String EXTRA_FOREGROUND = "foreground";

    private static final String TAG = SyncController.TAG;
    private static final String CHANNEL_ID = "sync";
    /** The notification was swiped away: show it again */
    private static final String ACTION_SHOW = "com.michael.teneo.sync.SHOW_NOTIFICATION";

    /** A web view that dies again and again is not worth restarting forever */
    private static final int MAX_QUICK_DEATHS = 5;
    /** A runtime that lived this long was not a crash loop */
    private static final long STABLE_MS = 60_000;
    private static final long FIRST_RESTART_DELAY_MS = 1_000;
    private static final long MAX_RESTART_DELAY_MS = 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private SyncController controller;
    private SyncRuntime runtime;
    private int quickDeaths;
    private boolean destroyed;
    private boolean foreground;
    /** Debug builds: dial what Bonjour finds (false: only listen and announce) */
    private static boolean debugDialOut = true;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        controller = SyncController.get(this);
        controller.serviceAttached(this);
        createChannel(this);
    }

    private static NotificationManager createChannel(Context context) {
        NotificationManager notifications = context.getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, context.getString(R.string.sync_channel_name), NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(context.getString(R.string.sync_channel_description));
        channel.setShowBadge(false);
        notifications.createNotificationChannel(channel);
        return notifications;
    }

    /**
     * Android refused to start sync in the background: say so where the sync
     * notification would be. The next start replaces it.
     */
    static void showPaused(Context context) {
        Notification paused = Notifications.builder(context, CHANNEL_ID)
            .setContentTitle(context.getString(R.string.sync_paused_title))
            .setContentText(context.getString(R.string.sync_paused_text))
            .setCategory(Notification.CATEGORY_SERVICE)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .build();
        createChannel(context).notify(Notifications.SYNC, paused);
    }

    /** Sync is off, or runs only with the app: nothing is left to say */
    static void clearNotification(Context context) {
        context.getSystemService(NotificationManager.class).cancel(Notifications.SYNC);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        boolean mustBeForeground = intent != null && intent.getBooleanExtra(EXTRA_FOREGROUND, false);
        // a start from startForegroundService must be answered even when it ends
        // the service, or the system ends the app
        if (mustBeForeground && !setForeground(true)) return stop();

        SyncRules.Mode mode = controller.mode();
        if (mode == SyncRules.Mode.OFF) {
            Log.i(TAG, intent == null ? "restarted by the system, but sync is off: stopping" : "sync is off: stopping");
            return stop();
        }
        if (!setForeground(mode == SyncRules.Mode.BACKGROUND)) return stop();
        if (runtime == null && !begin()) return stop();
        // only a sync that runs in the background is worth the system bringing back
        return mode == SyncRules.Mode.BACKGROUND ? START_STICKY : START_NOT_STICKY;
    }

    private int stop() {
        stopSelf();
        return START_NOT_STICKY;
    }

    /** Whether it is now as asked: becoming a foreground service can be refused */
    private boolean setForeground(boolean wanted) {
        if (!wanted) {
            if (foreground) stopForeground(STOP_FOREGROUND_REMOVE);
            foreground = false;
            // and a notice that sync is paused, left by a start that was refused
            clearNotification(this);
            return true;
        }
        if (foreground) {
            showAgainIfDismissed();
            return true;
        }
        if (!getSystemService(NotificationManager.class).areNotificationsEnabled()) {
            // the service still runs; the system just doesn't show why
            Log.w(TAG, "notifications are off for Teneo, so the sync notification is hidden");
        }
        try {
            startForeground(Notifications.SYNC, notification(), ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);
            foreground = true;
            return true;
        } catch (RuntimeException refused) {
            // not allowed to be a foreground service right now, or missing a permission
            Log.e(TAG, "could not start as a foreground service", refused);
            controller.problem("Android didn't let Teneo sync in the background. Open Teneo to sync again.");
            showPaused(this);
            return false;
        }
    }

    /** The user can swipe the notification away while the service runs on */
    private void showAgainIfDismissed() {
        NotificationManager notifications = getSystemService(NotificationManager.class);
        for (StatusBarNotification shown : notifications.getActiveNotifications()) {
            if (shown.getId() == Notifications.SYNC) return;
        }
        notifications.notify(Notifications.SYNC, notification());
    }

    private Notification notification() {
        Notification.Builder builder = Notifications.builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.sync_notification_title))
            .setContentText(getString(R.string.sync_notification_text))
            .setCategory(Notification.CATEGORY_SERVICE)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setShowWhen(false);
        // swiped away, it comes back: this service is told, and shows it again
        Intent show = new Intent(this, SyncService.class).setAction(ACTION_SHOW);
        builder.setDeleteIntent(PendingIntent.getService(this, 0, show, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT));
        if (Build.VERSION.SDK_INT >= 31) {
            builder.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        }
        return builder.build();
    }

    /** Start a runtime with the stored key. False when there is none to use. */
    private boolean begin() {
        byte[] key = controller.vaultKey();
        if (key == null) {
            Log.w(TAG, "no sync key to start with: stopping");
            return false;
        }
        String encoded = Base64.encodeToString(key, Base64.NO_WRAP);
        Arrays.fill(key, (byte) 0);
        Log.i(TAG, "starting sync");
        runtime = new SyncRuntime(this, this, encoded, controller.syncSecrets(), debugDialOut);
        runtime.start();
        controller.running(true);
        return true;
    }

    // --- what the controller tells us

    @Override
    public void settingsChanged() {
        if (runtime != null) runtime.setSyncSecrets(controller.syncSecrets());
    }

    @Override
    public void debugCommand(Intent command) {
        if (command.hasExtra("dial")) {
            debugDialOut = command.getBooleanExtra("dial", true);
            Log.i(TAG, "debug: dialing " + (debugDialOut ? "on" : "off") + " from the next start of the page");
        }
        if (runtime == null) return;
        String copy = command.getStringExtra("copy");
        if (copy != null) runtime.evaluate("teneoSyncPage.debug.copy(" + org.json.JSONObject.quote(copy) + ")");
        if (command.getBooleanExtra("crashPage", false)) runtime.debugCrash();
    }

    // --- what the runtime tells us

    @Override
    public void failed(String reason) {
        // a page on its way out says nothing that still matters
        if (destroyed) return;
        Log.e(TAG, "sync can't run: " + reason);
        if (runtime != null) runtime.abandon();
        runtime = null;
        controller.running(false);
        controller.problem("Sync couldn't start. Turn sync off, then join again.");
        stopSelf();
    }

    @Override
    public void peersChanged(List<KnownDevices.Peer> peers) {
        // after an unpair the devices are forgotten: the closing page must not bring them back
        if (destroyed) return;
        controller.peersChanged(peers);
    }

    @Override
    public void listening(int port) {
        if (destroyed) return;
        if (port < 0) controller.problem("Teneo couldn't open a port, so only this phone can start a connection.");
    }

    @Override
    public void pageGone(boolean crashed) {
        SyncRuntime dead = runtime;
        runtime = null;
        if (destroyed || dead == null) return;
        controller.running(false);
        quickDeaths = dead.ageMs() >= STABLE_MS ? 1 : quickDeaths + 1;
        if (quickDeaths > MAX_QUICK_DEATHS) {
            Log.e(TAG, "the sync page keeps dying: giving up");
            controller.problem("Sync stopped because it kept crashing. Open Teneo to try again.");
            stopSelf();
            return;
        }
        long delay = Math.min(MAX_RESTART_DELAY_MS, FIRST_RESTART_DELAY_MS << (quickDeaths - 1));
        Log.i(TAG, "restarting the sync page in " + delay + " ms (death " + quickDeaths + ")");
        main.postDelayed(this::restart, delay);
    }

    private void restart() {
        if (destroyed || runtime != null) return;
        // the rules may have changed while it waited, and the key is read again
        if (controller.mode() == SyncRules.Mode.OFF || !begin()) stopSelf();
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // swiping the app away from the recent apps does not stop a foreground
        // service, and sync in the background is meant to outlive the app's window
        if (foreground) {
            Log.i(TAG, "the app's task was removed; sync keeps running");
        } else {
            Log.i(TAG, "the app's task was removed, and sync runs only with the app: stopping");
            stopSelf();
        }
    }

    @Override
    public void onDestroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        if (runtime != null) runtime.stop();
        runtime = null;
        controller.serviceDetached(this);
        controller.running(false);
        super.onDestroy();
    }
}
