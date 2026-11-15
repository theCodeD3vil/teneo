package com.michael.teneo.updates;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import androidx.core.content.ContextCompat;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Downloads a release's APK from GitHub and hands it to Android's installer,
 * which asks the user and keeps their data: an update of a sideloaded app.
 * The page finds the release (src/updates/releases.ts); this checks what it
 * downloads before Android sees it.
 */
@CapacitorPlugin(name = "Updates")
public class UpdatePlugin extends Plugin {

    private static final String TAG = "TeneoUpdates";
    private static final String INSTALL_STATUS = "com.michael.teneo.updates.INSTALL_STATUS";
    private static final int TIMEOUT_MS = 30_000;

    private final ExecutorService worker = Executors.newSingleThreadExecutor(runnable -> {
        Thread thread = new Thread(runnable, "teneo-update");
        thread.setDaemon(true);
        return thread;
    });
    private final AtomicReference<Download> running = new AtomicReference<>();
    private BroadcastReceiver statusReceiver;

    private static final class Download {
        volatile boolean cancelled;
        volatile HttpURLConnection connection;

        void cancel() {
            cancelled = true;
            HttpURLConnection open = connection;
            // a read blocked on the network ends at once
            if (open != null) open.disconnect();
        }
    }

    private static final class Cancelled extends Exception {}

    /** A failure with what to tell the user */
    private static final class UpdateFailure extends Exception {
        UpdateFailure(String message) {
            super(message);
        }
    }

    @Override
    public void load() {
        statusReceiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                onInstallStatus(intent);
            }
        };
        // only this app's own PendingIntent sends it
        ContextCompat.registerReceiver(
            getContext(),
            statusReceiver,
            new IntentFilter(INSTALL_STATUS),
            ContextCompat.RECEIVER_NOT_EXPORTED
        );
    }

    @Override
    protected void handleOnDestroy() {
        try {
            getContext().unregisterReceiver(statusReceiver);
        } catch (IllegalArgumentException alreadyGone) {
            // never registered
        }
        Download download = running.get();
        if (download != null) download.cancel();
        worker.shutdown();
    }

    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", getContext().getPackageManager().canRequestPackageInstalls());
        call.resolve(result);
    }

    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        Intent settings = new Intent(
            Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
            Uri.parse("package:" + getContext().getPackageName())
        );
        try {
            getActivity().startActivity(settings);
            call.resolve();
        } catch (ActivityNotFoundException error) {
            call.reject("Couldn't open Android's settings", error);
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url");
        long size = UpdateRules.wholeNumber(call.getData().opt("size"));
        long versionCode = UpdateRules.wholeNumber(call.getData().opt("versionCode"));
        String sha256 = call.getString("sha256");
        if (!UpdateRules.isReleaseUrl(url)) {
            call.reject("That isn't a Teneo release");
            return;
        }
        if (size <= 0 || size > UpdateRules.MAX_SIZE || versionCode <= 0 || !UpdateRules.isDigest(sha256)) {
            call.reject("The release lists an update Teneo can't check");
            return;
        }
        Download download = new Download();
        if (!running.compareAndSet(null, download)) {
            call.reject("An update is already downloading");
            return;
        }
        worker.execute(() -> {
            File apk = new File(new File(getContext().getCacheDir(), "updates"), "update.apk");
            try {
                fetch(download, url, size, sha256, apk);
                checkArchive(apk, versionCode);
                if (download.cancelled) throw new Cancelled();
                commit(apk);
                call.resolve();
            } catch (Cancelled cancelled) {
                call.reject("Cancelled", "cancelled");
            } catch (UpdateFailure failure) {
                call.reject(failure.getMessage());
            } catch (IOException | RuntimeException error) {
                if (download.cancelled) {
                    call.reject("Cancelled", "cancelled");
                } else {
                    Log.w(TAG, "update failed", error);
                    call.reject("Couldn't download the update. Check the connection and try again");
                }
            } finally {
                //noinspection ResultOfMethodCallIgnored
                apk.delete();
                running.compareAndSet(download, null);
            }
        });
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        Download download = running.get();
        if (download != null) download.cancel();
        call.resolve();
    }

    private void fetch(Download download, String url, long size, String sha256, File apk)
        throws IOException, UpdateFailure, Cancelled {
        File folder = apk.getParentFile();
        if (folder == null || (!folder.isDirectory() && !folder.mkdirs())) {
            throw new UpdateFailure("There isn't room to download the update");
        }
        MessageDigest digest;
        try {
            digest = MessageDigest.getInstance("SHA-256");
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error);
        }

        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        download.connection = connection;
        try {
            if (download.cancelled) throw new Cancelled();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            // GitHub sends the file from its storage host, over HTTPS too
            connection.setInstanceFollowRedirects(true);
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new UpdateFailure("GitHub answered " + status);
            if (!"https".equals(connection.getURL().getProtocol())) {
                throw new UpdateFailure("GitHub sent the update over an insecure connection");
            }
            long length = connection.getContentLengthLong();
            if (length >= 0 && length != size) throw new UpdateFailure("The download isn't the size the release listed");

            long received = 0;
            long reported = 0;
            try (InputStream in = connection.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) {
                    if (download.cancelled) throw new Cancelled();
                    received += count;
                    if (received > size) throw new UpdateFailure("The download isn't the size the release listed");
                    digest.update(buffer, 0, count);
                    out.write(buffer, 0, count);
                    // about a hundred updates for the whole download
                    if (received - reported >= size / 100 || received == size) {
                        reported = received;
                        progress(received, size);
                    }
                }
            }
            if (download.cancelled) throw new Cancelled();
            if (received != size) throw new UpdateFailure("The download stopped early. Try again");
            if (sha256 != null && !sha256.equals(UpdateRules.hex(digest.digest()))) {
                throw new UpdateFailure("The download doesn't match the release. Try again");
            }
        } finally {
            connection.disconnect();
        }
    }

    private void progress(long received, long total) {
        JSObject event = new JSObject();
        event.put("received", received);
        event.put("total", total);
        notifyListeners("progress", event);
    }

    private void checkArchive(File apk, long versionCode) throws UpdateFailure {
        PackageManager packages = getContext().getPackageManager();
        String self = getContext().getPackageName();
        PackageInfo archive = packages.getPackageArchiveInfo(apk.getPath(), 0);
        long installed;
        try {
            installed = packages.getPackageInfo(self, 0).getLongVersionCode();
        } catch (PackageManager.NameNotFoundException error) {
            throw new IllegalStateException(error);
        }
        String problem = UpdateRules.archiveProblem(
            archive == null ? null : archive.packageName,
            archive == null ? -1 : archive.getLongVersionCode(),
            self,
            versionCode,
            installed
        );
        if (problem != null) throw new UpdateFailure(problem);
    }

    /** Hands the APK to Android's installer; the outcome comes to onInstallStatus */
    private void commit(File apk) throws IOException {
        Context context = getContext();
        PackageInstaller installer = context.getPackageManager().getPackageInstaller();
        PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
            PackageInstaller.SessionParams.MODE_FULL_INSTALL
        );
        params.setAppPackageName(context.getPackageName());
        params.setSize(apk.length());
        int id = installer.createSession(params);
        boolean committed = false;
        try (PackageInstaller.Session session = installer.openSession(id)) {
            try (InputStream in = new FileInputStream(apk); OutputStream out = session.openWrite("teneo.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = in.read(buffer)) != -1) out.write(buffer, 0, count);
                session.fsync(out);
            }
            // mutable: the installer adds the status; explicit, as Android 14 requires of that
            Intent status = new Intent(INSTALL_STATUS).setPackage(context.getPackageName());
            PendingIntent pending = PendingIntent.getBroadcast(
                context,
                id,
                status,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_MUTABLE
            );
            session.commit(pending.getIntentSender());
            committed = true;
        } finally {
            if (!committed) installer.abandonSession(id);
        }
    }

    private void onInstallStatus(Intent intent) {
        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        JSObject event = new JSObject();
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_INTENT, Intent.class);
            if (confirm != null && openConfirmation(confirm)) {
                event.put("status", "pending_user");
            } else {
                event.put("status", "failed");
                event.put("message", "Couldn't open Android's installer");
            }
        } else if (status == PackageInstaller.STATUS_SUCCESS) {
            event.put("status", "installed");
        } else if (status == PackageInstaller.STATUS_FAILURE_ABORTED) {
            event.put("status", "cancelled");
        } else {
            Log.w(TAG, "install failed: " + status + " " + intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE));
            event.put("status", "failed");
            event.put("message", UpdateRules.installFailure(status));
        }
        notifyListeners("installStatus", event);
    }

    private boolean openConfirmation(Intent confirm) {
        Activity activity = getActivity();
        try {
            if (activity != null) {
                activity.startActivity(confirm);
            } else {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(confirm);
            }
            return true;
        } catch (RuntimeException error) {
            Log.w(TAG, "couldn't open the installer", error);
            return false;
        }
    }
}
