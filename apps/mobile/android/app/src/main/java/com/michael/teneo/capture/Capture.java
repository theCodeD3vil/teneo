package com.michael.teneo.capture;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.PersistableBundle;
import android.util.Log;
import android.widget.Toast;
import com.michael.teneo.R;
import com.michael.teneo.history.ClipboardWriter;
import com.michael.teneo.history.HistoryStore;
import com.michael.teneo.history.ImageFiles;
import com.michael.teneo.history.SyncQueries;
import com.michael.teneo.history.Settings;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Collections;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Saves what was copied on the phone: the clipboard when Teneo comes to the
 * front ("Save what's on the clipboard when Teneo opens"), and a text shared
 * to "Save to Teneo". The secrets and links in it are found by the app's web
 * view before it lists the text (src/client/native-client.ts).
 */
public final class Capture {

    private static final String TAG = "TeneoCapture";

    // one save at a time, off the main thread
    private static final ExecutorService worker = Executors.newSingleThreadExecutor();

    private Capture() {}

    /**
     * Save the clipboard's text, if the setting is on. Android hands an app the
     * clipboard only while one of its windows has focus, which comes after
     * onResume, so this runs when the window gains it.
     */
    public static void onWindowFocused(Context context) {
        Context app = context.getApplicationContext();
        ClipboardManager clipboard = app.getSystemService(ClipboardManager.class);
        if (clipboard == null) return;
        worker.execute(() -> {
            try {
                captureClipboard(app, clipboard);
            } catch (RuntimeException error) {
                Log.w(TAG, "Couldn't save the clipboard", error);
            }
        });
    }

    private static void captureClipboard(Context context, ClipboardManager clipboard) {
        HistoryStore store = HistoryStore.get(context);
        if (!Settings.bool(store.settings(), Settings.CAPTURE_ON_OPEN, Settings.DEFAULT_CAPTURE_ON_OPEN)) return;
        ClipDescription description = clipboard.getPrimaryClipDescription();
        if (description == null) return;
        PersistableBundle extras = description.getExtras();
        boolean sensitive = extras != null && extras.getBoolean(ClipboardWriter.EXTRA_IS_SENSITIVE, false);
        long copiedAt = description.getTimestamp();
        if (description.hasMimeType("image/*")) {
            if (!CaptureRules.shouldRead(true, sensitive, copiedAt, store.seenClip())) return;
            ClipData copied = clipboard.getPrimaryClip();
            if (copied == null || copied.getItemCount() == 0) return;
            store.rememberSeenClip(copiedAt);
            Uri image = copied.getItemAt(0).getUri();
            // an image Teneo itself put there is in the history already
            if (image == null || ClipboardWriter.imageAuthority(context).equals(image.getAuthority())) return;
            File temp = copyToTemp(context, image);
            if (temp != null) saveImage(context, store, temp, CaptureRules.dateCopied(copiedAt, System.currentTimeMillis()));
            return;
        }
        if (!CaptureRules.shouldRead(description.hasMimeType("text/*"), sensitive, copiedAt, store.seenClip())) return;

        ClipData clip = clipboard.getPrimaryClip();
        // null once the window lost focus again: the next focus tries again
        if (clip == null || clip.getItemCount() == 0) return;
        store.rememberSeenClip(copiedAt);
        CharSequence copied = clip.getItemAt(0).getText();
        if (copied == null || copied.length() == 0) return;
        String text = copied.toString();
        boolean isSameUntimedClip = CaptureRules.isSameUntimedClip(copiedAt, store.isSeenClipText(text));
        store.rememberSeenClipText(text);
        if (isSameUntimedClip) return;
        if (CaptureRules.isOwnWrite(store.isWrittenClip(text), store.writtenClipTime(), copiedAt)) return;
        // another clip is on the clipboard now, so what Teneo wrote is gone
        // from it: the same text copied later is the user's own copy
        store.forgetWrittenClip();
        store.saveText(newText(context, text), CaptureRules.dateCopied(copiedAt, System.currentTimeMillis()));
    }

    /**
     * Copy what a clip or a share hands over into a file of Teneo's own, while
     * Teneo may still read it. Null when it can't be read or is larger than an
     * image may be.
     */
    public static File copyToTemp(Context context, Uri image) {
        File temp = null;
        try {
            temp = File.createTempFile("capture", ".image", context.getCacheDir());
            try (InputStream in = context.getContentResolver().openInputStream(image); OutputStream out = new FileOutputStream(temp)) {
                if (in == null) throw new IOException("Nothing to read");
                byte[] chunk = new byte[64 * 1024];
                long copied = 0;
                for (int read = in.read(chunk); read >= 0; read = in.read(chunk)) {
                    copied += read;
                    if (copied > SyncQueries.MAX_IMAGE_BYTES) throw new IOException("The image is too large");
                    out.write(chunk, 0, read);
                }
            }
            return temp;
        } catch (IOException | RuntimeException error) {
            Log.w(TAG, "Couldn't read the image", error);
            if (temp != null) temp.delete();
            return null;
        }
    }

    /**
     * Save an image the phone copied or shared, and delete `temp`. A png,
     * jpeg, gif or webp is kept as it is; any other kind the phone can read
     * (a heic photo) is redrawn as one, since the Mac and the web view must be
     * able to show it. False when it isn't an image, or is too large.
     */
    private static boolean saveImage(Context context, HistoryStore store, File temp, long dateCopied) {
        File redrawn = null;
        try {
            BitmapFactory.Options bounds = new BitmapFactory.Options();
            bounds.inJustDecodeBounds = true;
            BitmapFactory.decodeFile(temp.getPath(), bounds);
            if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false;
            File image = temp;
            if (ImageFiles.typeOf(ImageFiles.head(temp)) == null) {
                Bitmap bitmap = BitmapFactory.decodeFile(temp.getPath());
                if (bitmap == null) return false;
                redrawn = File.createTempFile("capture", ".redrawn", context.getCacheDir());
                try (OutputStream out = new FileOutputStream(redrawn)) {
                    // a picture with see-through parts keeps them
                    boolean drawn = bitmap.hasAlpha()
                        ? bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
                        : bitmap.compress(Bitmap.CompressFormat.JPEG, 90, out);
                    if (!drawn) return false;
                } finally {
                    bitmap.recycle();
                }
                image = redrawn;
            }
            return store.saveImage(image, bounds.outWidth, bounds.outHeight, deviceName(context), dateCopied) != null;
        } catch (IOException | RuntimeException | OutOfMemoryError error) {
            Log.w(TAG, "Couldn't save the image", error);
            return false;
        } finally {
            temp.delete();
            if (redrawn != null) redrawn.delete();
        }
    }

    /** Save a shared image, already copied to `temp`, then say so briefly */
    public static void saveSharedImage(Context context, File temp) {
        Context app = context.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        worker.execute(() -> {
            boolean saved = false;
            try {
                saved = saveImage(app, HistoryStore.get(app), temp, System.currentTimeMillis());
            } catch (RuntimeException error) {
                Log.w(TAG, "Couldn't save the shared image", error);
            }
            int shown = saved ? R.string.share_saved : R.string.share_failed;
            main.post(() -> Toast.makeText(app, shown, Toast.LENGTH_SHORT).show());
        });
    }

    /** Save a shared text, then say so briefly */
    public static void saveShared(Context context, String text) {
        Context app = context.getApplicationContext();
        Handler main = new Handler(Looper.getMainLooper());
        worker.execute(() -> {
            int message;
            try {
                HistoryStore.get(app).saveText(newText(app, text), System.currentTimeMillis());
                message = R.string.share_saved;
            } catch (RuntimeException error) {
                Log.w(TAG, "Couldn't save the shared text", error);
                message = R.string.share_failed;
            }
            int shown = message;
            main.post(() -> Toast.makeText(app, shown, Toast.LENGTH_SHORT).show());
        });
    }

    /** A text copied on this phone, which the list shows as from the phone's name */
    private static HistoryStore.NewText newText(Context context, String text) {
        return new HistoryStore.NewText(text, deviceName(context), null, Collections.emptyList(), null, null, null);
    }

    /** The name the phone's settings give it, such as "Pixel 6 Pro" */
    static String deviceName(Context context) {
        String name = android.provider.Settings.Global.getString(
            context.getContentResolver(),
            android.provider.Settings.Global.DEVICE_NAME
        );
        return name == null || name.isBlank() ? Build.MODEL : name;
    }
}
