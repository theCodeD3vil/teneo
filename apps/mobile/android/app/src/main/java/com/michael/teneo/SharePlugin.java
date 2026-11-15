package com.michael.teneo;

import android.content.Intent;
import android.net.Uri;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.michael.teneo.history.ClipboardWriter;
import com.michael.teneo.history.HistoryStore;

/**
 * Hands text, or an image of the history, to Android's share sheet. The app's web view has no
 * `navigator.share`, so the page asks for it here.
 */
@CapacitorPlugin(name = "Share")
public class SharePlugin extends Plugin {

    /** Opens the share sheet for `text`, resolving once it is up */
    @PluginMethod
    public void share(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.isEmpty()) {
            call.reject("Nothing to share");
            return;
        }
        Intent send = new Intent(Intent.ACTION_SEND);
        send.setType("text/plain");
        send.putExtra(Intent.EXTRA_TEXT, text);
        try {
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        } catch (RuntimeException error) {
            // text too large to hand over, or nothing to hand it to
            call.reject("Couldn't open the share sheet", error);
        }
    }

    /** Opens the share sheet for the image of history item `id`, resolving once it is up */
    @PluginMethod
    public void shareImage(PluginCall call) {
        String id = call.getString("id");
        try {
            HistoryStore.Item item = id == null ? null : HistoryStore.get(getContext()).getItem(id);
            if (item == null || item.imageFile == null || !item.imageFile.isFile()) {
                call.reject("There is no image to share");
                return;
            }
            // the other app reads the file through Teneo, for this share only
            Uri image = FileProvider.getUriForFile(getContext(), ClipboardWriter.imageAuthority(getContext()), item.imageFile);
            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType("image/*");
            send.putExtra(Intent.EXTRA_STREAM, image);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().startActivity(Intent.createChooser(send, null));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Couldn't open the share sheet", error);
        }
    }
}
