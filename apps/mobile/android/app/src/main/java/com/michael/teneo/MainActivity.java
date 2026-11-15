package com.michael.teneo;

import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;
import com.michael.teneo.capture.Capture;
import com.michael.teneo.history.HistoryPlugin;
import com.michael.teneo.links.LinkFetchPlugin;
import com.michael.teneo.sync.SyncController;
import com.michael.teneo.sync.SyncPlugin;
import com.michael.teneo.updates.UpdatePlugin;

public class MainActivity extends BridgeActivity {

    /** Deaths of the web view's process this close together are a loop: stop recreating */
    private static final long QUICK_DEATH_MS = 30_000;
    private static final int MAX_QUICK_DEATHS = 3;
    private static int quickDeaths;
    private static long lastDeathAt;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(QrScannerPlugin.class);
        registerPlugin(SharePlugin.class);
        registerPlugin(HistoryPlugin.class);
        registerPlugin(SyncPlugin.class);
        registerPlugin(UpdatePlugin.class);
        registerPlugin(LinkFetchPlugin.class);
        super.onCreate(savedInstanceState);

        // The app's page and the sync service's share one web view process.
        // When it dies, Capacitor's client lets Android end the whole app,
        // sync included, so the activity starts over with a new page instead.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (getBridge() == null || view != getBridge().getWebView()) return false;
                pageGone(detail.didCrash());
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
                    getBridge().getWebView().goBack();
                } else {
                    setEnabled(false);
                    getOnBackPressedDispatcher().onBackPressed();
                    setEnabled(true);
                }
            }
        });
    }

    private void pageGone(boolean crashed) {
        long now = SystemClock.elapsedRealtime();
        quickDeaths = now - lastDeathAt < QUICK_DEATH_MS ? quickDeaths + 1 : 1;
        lastDeathAt = now;
        if (quickDeaths > MAX_QUICK_DEATHS) {
            // close the window only: the process, and sync with it, carries on
            Log.e("Teneo", "the app's page keeps dying: closing the window");
            finish();
            return;
        }
        Log.w("Teneo", "the app's page is gone (crashed=" + crashed + "): starting it again");
        recreate();
    }

    @Override
    public void onStart() {
        super.onStart();
        SyncController.get(this).setAppVisible(true);
    }

    @Override
    public void onStop() {
        super.onStop();
        // a configuration change starts the activity again at once: no need to stop sync for it
        if (!isChangingConfigurations()) SyncController.get(this).setAppVisible(false);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) Capture.onWindowFocused(this);
    }
}
