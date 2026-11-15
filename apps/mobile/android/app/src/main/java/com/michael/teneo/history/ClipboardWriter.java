package com.michael.teneo.history;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.net.Uri;
import android.os.PersistableBundle;
import androidx.core.content.FileProvider;
import java.io.File;

/** Puts text or an image on the phone's clipboard, and notes that Teneo put it there */
public final class ClipboardWriter {

    // ClipDescription.EXTRA_IS_SENSITIVE, a constant from API 33 that older
    // versions ignore
    public static final String EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    private ClipboardWriter() {}

    /** Who hands out the history's image files: a clip from here is Teneo's own */
    public static String imageAuthority(Context context) {
        return context.getPackageName() + ".fileprovider";
    }

    /**
     * Put an image of the history on the clipboard. Another app reads the
     * file through Teneo, for as long as it is on the clipboard. Throws if it
     * couldn't be put there.
     */
    public static void writeImage(Context context, File image) {
        ClipboardManager clipboard = context.getSystemService(ClipboardManager.class);
        if (clipboard == null) throw new IllegalStateException("This phone has no clipboard");
        Uri uri = FileProvider.getUriForFile(context, imageAuthority(context), image);
        clipboard.setPrimaryClip(ClipData.newUri(context.getContentResolver(), "Teneo", uri));
    }

    /**
     * Put `text` on the clipboard. A `sensitive` text is marked so: the
     * keyboard's clipboard suggestions and Android's preview leave it out.
     * Throws if it couldn't be put there, such as a text too large to hand over.
     */
    public static void write(Context context, HistoryStore store, String text, boolean sensitive) {
        ClipboardManager clipboard = context.getSystemService(ClipboardManager.class);
        if (clipboard == null) throw new IllegalStateException("This phone has no clipboard");
        ClipData clip = ClipData.newPlainText("Teneo", text);
        if (sensitive) {
            PersistableBundle extras = new PersistableBundle();
            extras.putBoolean(EXTRA_IS_SENSITIVE, true);
            clip.getDescription().setExtras(extras);
        }
        // noted first: once on the clipboard, the next time Teneo looks at it
        // must already know not to save it again
        store.rememberWrittenClip(text);
        clipboard.setPrimaryClip(clip);
        // The clip's time tells Teneo's clip from the same text copied again
        // elsewhere. It can only be read back while Teneo has focus.
        ClipDescription written = clipboard.getPrimaryClipDescription();
        if (written != null) store.rememberWrittenClipTime(written.getTimestamp());
    }
}
