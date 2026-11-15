package com.michael.teneo.capture;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.widget.Toast;
import com.michael.teneo.R;

/**
 * "Save to Teneo" in the share sheet. It has no screen: it saves the shared
 * text, says so in a toast, and the user stays in the app they shared from.
 */
public class ShareActivity extends Activity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Intent intent = getIntent();
        CharSequence shared = Intent.ACTION_SEND.equals(intent.getAction())
            ? intent.getCharSequenceExtra(Intent.EXTRA_TEXT)
            : null;
        if (shared == null || shared.length() == 0) {
            Toast.makeText(getApplicationContext(), R.string.share_no_text, Toast.LENGTH_SHORT).show();
        } else {
            Capture.saveShared(this, shared.toString());
        }
        // a NoDisplay activity must finish before it would be shown
        finish();
    }
}
