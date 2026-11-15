package com.michael.teneo.history;

import android.content.ClipData;
import android.content.ClipDescription;
import android.content.ClipboardManager;
import android.content.Context;
import android.os.PersistableBundle;

/** Puts text on the phone's clipboard, and notes that Teneo put it there */
public final class ClipboardWriter {

    // ClipDescription.EXTRA_IS_SENSITIVE, a constant from API 33 that older
    // versions ignore
    public static final String EXTRA_IS_SENSITIVE = "android.content.extra.IS_SENSITIVE";

    private ClipboardWriter() {}

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
