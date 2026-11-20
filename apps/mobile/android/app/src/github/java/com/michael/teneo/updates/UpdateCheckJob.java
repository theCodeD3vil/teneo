package com.michael.teneo.updates;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.util.Log;
import com.michael.teneo.Notifications;
import com.michael.teneo.R;
import com.michael.teneo.history.HistoryStore;
import com.michael.teneo.history.Settings;
import java.io.IOException;
import org.json.JSONException;

/**
 * Looks for a newer release about once a day without the app being open, and
 * says so in a notification when there is one: once for each version, and
 * only while "Check for updates" is on. Tapping it opens the app on the
 * update. Android runs it when the phone has a connection, and keeps it
 * across reboots.
 */
public final class UpdateCheckJob extends JobService {

    private static final String TAG = "TeneoUpdates";
    private static final int JOB_ID = 1;
    private static final long ONE_DAY_MS = 24L * 60 * 60 * 1000;
    private static final int TIMEOUT_MS = 15_000;
    /** A listing longer than this is not GitHub's */
    private static final int MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
    private static final String CHANNEL_ID = "updates";
    private static final String PREFERENCES = "teneo-updates";
    private static final String NOTIFIED_VERSION = "notifiedVersion";
    // the same default as src/types/settings.ts, for before the app has saved it
    private static final String CHECK_FOR_UPDATES = "checkForUpdates";
    private static final boolean DEFAULT_CHECK_FOR_UPDATES = true;

    private volatile Thread worker;

    /** Have Android run the check daily. It keeps a job it already has. */
    static void schedule(Context context) {
        JobScheduler scheduler = context.getSystemService(JobScheduler.class);
        if (scheduler == null || scheduler.getPendingJob(JOB_ID) != null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(context, UpdateCheckJob.class))
            .setPeriodic(ONE_DAY_MS)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true)
            .build();
        if (scheduler.schedule(job) != JobScheduler.RESULT_SUCCESS) Log.w(TAG, "could not schedule the daily update check");
    }

    /** Take the notification down once the version it names is installed */
    static void clearIfInstalled(Context context) {
        SharedPreferences preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        String notified = preferences.getString(NOTIFIED_VERSION, null);
        if (notified == null) return;
        if (ReleaseRules.versionCode(notified) > ReleaseRules.versionCode(installedVersion(context))) return;
        context.getSystemService(NotificationManager.class).cancel(Notifications.UPDATE);
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        Thread thread = new Thread(
            () -> {
                try {
                    check();
                } catch (IOException | JSONException | RuntimeException failed) {
                    // tomorrow's check tries again
                    Log.w(TAG, "the daily update check failed", failed);
                } finally {
                    jobFinished(params, false);
                }
            },
            "teneo-update-check"
        );
        worker = thread;
        thread.start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) {
        Thread thread = worker;
        if (thread != null) thread.interrupt();
        return false;
    }

    private void check() throws IOException, JSONException {
        if (!Settings.bool(HistoryStore.get(this).settings(), CHECK_FOR_UPDATES, DEFAULT_CHECK_FOR_UPDATES)) return;
        String installed = installedVersion(this);
        String version = findUpdate(installed, getPackageName(), installedVersionCode(this));
        if (version == null) return;
        SharedPreferences preferences = getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
        if (version.equals(preferences.getString(NOTIFIED_VERSION, null))) return;
        NotificationManager notifications = getSystemService(NotificationManager.class);
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, getString(R.string.update_channel_name), NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription(getString(R.string.update_channel_description));
        notifications.createNotificationChannel(channel);
        Notification notification = Notifications.builder(this, CHANNEL_ID, true)
            .setContentTitle(getString(R.string.update_notification_title, version))
            .setContentText(getString(R.string.update_notification_text))
            .setCategory(Notification.CATEGORY_RECOMMENDATION)
            .setAutoCancel(true)
            .build();
        // with notifications off for Teneo this shows nothing, and says so to nobody
        notifications.notify(Notifications.UPDATE, notification);
        preferences.edit().putString(NOTIFIED_VERSION, version).apply();
        Log.i(TAG, "said that " + version + " is available");
    }

    /**
     * The newest release that would update `installed`, or null. Only a
     * release whose manifest is signed with Teneo's update key counts: one
     * made without that key is never announced.
     */
    private static String findUpdate(String installed, String packageName, long installedCode) throws IOException, JSONException {
        // the signed manifest in Teneo's update channel says what the newest
        // release is: one small download, and nothing unsigned is believed
        try {
            SignedManifest manifest = SignedManifest.latest(packageName, null);
            return manifest != null && manifest.versionCode > installedCode ? manifest.version : null;
        } catch (SignedManifest.Invalid refused) {
            Log.w(TAG, "the update channel's manifest isn't one Teneo can install: " + refused.getMessage());
            return null;
        }
    }

    private static long installedVersionCode(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).getLongVersionCode();
        } catch (PackageManager.NameNotFoundException impossible) {
            return Long.MAX_VALUE;
        }
    }

    private static String installedVersion(Context context) {
        try {
            return context.getPackageManager().getPackageInfo(context.getPackageName(), 0).versionName;
        } catch (PackageManager.NameNotFoundException impossible) {
            return null;
        }
    }
}
