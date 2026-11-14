package com.michael.teneo;

import android.content.Intent;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Hands text to Android's share sheet. The app's web view has no
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
}
