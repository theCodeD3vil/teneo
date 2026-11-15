package com.michael.teneo.capture;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;
import com.michael.teneo.R;
import java.io.File;

/**
 * "Save to Teneo" in the share sheet. It has no screen: it saves the shared
 * text, says so in a toast, and the user stays in the app they shared from.
 */
public class ShareActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        boolean isSend = Intent.ACTION_SEND.equals(intent.getAction());
        Uri image = isSend && intent.getType() != null && intent.getType().startsWith("image/")
            ? intent.getParcelableExtra(Intent.EXTRA_STREAM)
            : null;
        if (image != null) {
            // read now: once this activity is gone, so is its leave to read what was shared
            File temp = Capture.copyToTemp(this, image);
            if (temp == null) Toast.makeText(getApplicationContext(), R.string.share_failed, Toast.LENGTH_SHORT).show();
            else Capture.saveSharedImage(this, temp);
            finish();
            return;
        }
        CharSequence shared = isSend ? intent.getCharSequenceExtra(Intent.EXTRA_TEXT) : null;
        if (shared == null || shared.length() == 0) {
            Toast.makeText(getApplicationContext(), R.string.share_no_text, Toast.LENGTH_SHORT).show();
        } else {
            Capture.saveShared(this, shared.toString());
        }
        // a NoDisplay activity must finish before it would be shown
        finish();
    }
}
