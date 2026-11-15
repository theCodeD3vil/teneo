package com.michael.teneo.sync;

import android.annotation.SuppressLint;
import android.content.Context;
import android.content.pm.ApplicationInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.michael.teneo.history.AppIcons;
import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * One run of sync on this phone: a web view with no window that runs the sync
 * core (apps/mobile/src/sync-service), and the native side it leans on, the
 * listener, the dialer and Bonjour. The core decides everything; this gives
 * it what a page can't have: sockets that reach the local network, and a
 * place to run with the screen off.
 *
 * A runtime is used once. When its web view's process dies or the core says
 * it can't run, it is dropped and the service makes a new one.
 */
final class SyncRuntime {

    interface Host {
        /** The core can't run, so there is nothing to retry: the key is no good */
        void failed(String reason);

        /** The web view's process died, and this runtime with it */
        void pageGone(boolean crashed);

        /** These devices are connected now */
        void peersChanged(List<KnownDevices.Peer> peers);

        /** The port this phone listens on, or -1 when none was free */
        void listening(int port);
    }

    private static final String TAG = "TeneoSync";
    /** The core is told to stop, and this long later the web view is destroyed,
     *  which leaves time for the close frames to leave */
    private static final long STOP_GRACE_MS = 300;
    /** Message text handed to the page and not yet run by it. Past this, the
     *  thread reading a socket waits, so a device that sends faster than the
     *  page takes is slowed by its own connection instead of filling memory.
     *  One message always gets through, whatever its size. */
    private static final long MAX_WAITING_CHARS = 2L * 1024 * 1024;

    private final Context context;
    private final Host host;
    /** The vault key, base64: handed to the page once, then let go of */
    private String vaultKey;
    private volatile boolean syncSecrets;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final boolean debuggable;
    /** False: listen and announce, but never dial what Bonjour finds. For a
     *  network where only the others can reach this phone. */
    private final boolean dialOut;

    // main thread
    private WebView page;
    private NsdDiscovery discovery;
    private volatile boolean closed;
    private long startedAt;

    // messages on their way to the page: guarded by `waiting`
    private final Object waiting = new Object();
    private long waitingChars;

    private volatile SyncNetwork network;

    /** The phone's history, for the page; a change to it is news for the core */
    private final SyncStoreBridge history;

    SyncRuntime(Context context, Host host, String vaultKey, boolean syncSecrets, boolean dialOut) {
        this.context = context.getApplicationContext();
        this.host = host;
        this.vaultKey = vaultKey;
        this.syncSecrets = syncSecrets;
        this.dialOut = dialOut;
        this.history = new SyncStoreBridge(
            context,
            () -> evaluate("window.teneoSyncPage && teneoSyncPage.localChanged && teneoSyncPage.localChanged()")
        );
        this.debuggable = (context.getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0;
    }

    /** Main thread */
    @SuppressLint("SetJavaScriptEnabled")
    void start() {
        startedAt = System.currentTimeMillis();
        if (debuggable) WebView.setWebContentsDebuggingEnabled(true);
        // never attached to a window: there is no screen for it
        page = new WebView(context);
        WebSettings settings = page.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setDomStorageEnabled(false);
        // Without this the web view's process is the first to go when memory is
        // short while no window shows it, though the service that owns it is
        // as important as ever
        page.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
        page.addJavascriptInterface(new Bridge(), "TeneoNative");
        page.setWebViewClient(new Client());
        page.loadUrl(PageAssets.ORIGIN + "sync.html");
    }

    /** How long this run has lasted, for deciding whether a restart is a crash loop */
    long ageMs() {
        return System.currentTimeMillis() - startedAt;
    }

    /** Whether items holding secrets may travel: read by the page from now on */
    void setSyncSecrets(boolean allowed) {
        syncSecrets = allowed;
        evaluate("teneoSyncPage.setSyncSecrets(" + allowed + ")");
    }

    /** Debug builds: kill the web view's process, as the system would. It is
     *  shared with the app's own web view, if that is open. */
    void debugCrash() {
        if (!debuggable) return;
        main.post(() -> {
            if (!closed && page != null) page.loadUrl("chrome://crash");
        });
    }

    /** Runs script in the page. Any thread. */
    void evaluate(String script) {
        main.post(() -> {
            if (!closed && page != null) page.evaluateJavascript(script, null);
        });
    }

    /**
     * Runs a message's script in the page, and counts its text as waiting
     * until the page has run it. Called on a socket's reading thread, which
     * waits here while too much is waiting already.
     */
    private void deliver(String script, int chars) {
        synchronized (waiting) {
            while (waitingChars > MAX_WAITING_CHARS && !closed) {
                try {
                    waiting.wait(1_000);
                } catch (InterruptedException stopping) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
            if (closed) return;
            waitingChars += chars;
        }
        main.post(() -> {
            if (closed || page == null) {
                delivered(chars);
                return;
            }
            page.evaluateJavascript(script, done -> delivered(chars));
        });
    }

    private void delivered(int chars) {
        synchronized (waiting) {
            waitingChars -= chars;
            waiting.notifyAll();
        }
    }

    /** Lets go of every thread waiting to hand the page a message */
    private void releaseWaiting() {
        synchronized (waiting) {
            waiting.notifyAll();
        }
    }

    /** Ends sync politely: the page closes its connections, then everything is torn down. Main thread. */
    void stop() {
        if (closed) return;
        if (discovery != null) discovery.stop(); // the announcement goes first
        evaluate("teneoSyncPage.stop()");
        main.postDelayed(this::dispose, STOP_GRACE_MS);
    }

    /** Ends it now, with nothing said to anyone: the page is gone. Main thread. */
    void abandon() {
        if (closed) return;
        closed = true;
        releaseWaiting();
        history.close();
        if (discovery != null) discovery.stop();
        SyncNetwork current = network;
        if (current != null) current.stopNow();
        destroyPage();
    }

    private void dispose() {
        if (closed) return;
        closed = true;
        releaseWaiting();
        history.close();
        SyncNetwork current = network;
        if (current != null) current.stop();
        destroyPage();
    }

    private void destroyPage() {
        if (page == null) return;
        page.removeJavascriptInterface("TeneoNative");
        page.destroy();
        page = null;
    }

    // --- the network, started when the page has made the device's keys

    private void startNetwork(String tag, String deviceId) {
        if (closed || network != null) return;
        SyncNetwork started = new SyncNetwork(SyncLimits.PORTS, SyncLimits.defaults(), LocalAddress::isLocalNetwork, events);
        int port = started.start();
        if (port < 0) Log.w(TAG, "none of the sync ports is free: this phone can only dial out");
        else Log.i(TAG, "listening on port " + port);
        network = started;
        host.listening(port);

        discovery = new NsdDiscovery(
            context,
            main,
            LocalAddress::isLocalNetwork,
            (device, addresses, devicePort) -> {
                Log.i(TAG, "found " + device.substring(0, 8) + " at " + addresses + " port " + devicePort + (dialOut ? "" : " (not dialing)"));
                if (dialOut) evaluate("teneoSyncPage.discovered(" + JSONObject.quote(device) + "," + new JSONArray(addresses) + "," + devicePort + ")");
            }
        );
        // a phone with no port announces nothing and only looks
        discovery.start(tag, deviceId, port);
    }

    private final SyncNetwork.Events events = new SyncNetwork.Events() {
        @Override
        public void opened(int id, String address, boolean initiator) {
            Log.i(TAG, "connection " + id + (initiator ? " dialed " : " from ") + address);
            evaluate("teneoSyncPage.opened(" + id + "," + JSONObject.quote(address) + "," + initiator + ")");
        }

        @Override
        public void message(int id, String text) {
            deliver("teneoSyncPage.message(" + id + "," + JSONObject.quote(text) + ")", text.length());
        }

        @Override
        public void closed(int id, String reason) {
            Log.i(TAG, "connection " + id + " closed" + (reason.isEmpty() ? "" : ": " + reason));
            evaluate("teneoSyncPage.closed(" + id + "," + JSONObject.quote(reason) + ")");
        }

        @Override
        public void error(String what, Throwable error) {
            Log.w(TAG, what, error);
        }
    };

    // --- what the page may ask of native code. Called on a web view thread.

    private final class Bridge {

        /** The page is up: hand it the key, once */
        @JavascriptInterface
        public void pageLoaded() {
            String key;
            synchronized (SyncRuntime.this) {
                key = vaultKey;
                vaultKey = null;
            }
            if (key == null) return;
            evaluate("teneoSyncPage.start(" + JSONObject.quote(key) + "," + syncSecrets + ")");
        }

        /** The connected devices changed: a JSON array of {deviceId, name, platform} */
        @JavascriptInterface
        public void peersChanged(String json) {
            List<KnownDevices.Peer> peers = new ArrayList<>();
            try {
                JSONArray list = new JSONArray(json);
                for (int i = 0; i < list.length(); i++) {
                    JSONObject peer = list.getJSONObject(i);
                    peers.add(new KnownDevices.Peer(peer.getString("deviceId"), peer.optString("name", ""), peer.optString("platform", "")));
                }
            } catch (JSONException malformed) {
                Log.w(TAG, "the page reported its devices in a way native code can't read");
                return;
            }
            main.post(() -> {
                if (!closed) host.peersChanged(peers);
            });
        }

        /** The core has its keys: start listening, announcing and browsing */
        @JavascriptInterface
        public void ready(String tag, String deviceId) {
            main.post(() -> startNetwork(tag, deviceId));
        }

        /** The core can't run; nothing here would help */
        @JavascriptInterface
        public void failed(String reason) {
            main.post(() -> {
                if (!closed) host.failed(reason);
            });
        }

        /** Dials host:port. The answer is an `opened` or a `closed` for the returned number. */
        @JavascriptInterface
        public int connect(String address) {
            SyncNetwork current = network;
            return current == null ? -1 : current.connect(address);
        }

        @JavascriptInterface
        public boolean send(int connection, String message) {
            SyncNetwork current = network;
            return current != null && current.send(connection, message);
        }

        @JavascriptInterface
        public void close(int connection, String reason) {
            SyncNetwork current = network;
            if (current != null) current.close(connection, reason);
        }

        /** A connection from this address failed its handshake */
        @JavascriptInterface
        public void handshakeFailed(String address) {
            SyncNetwork current = network;
            if (current != null) current.handshakeFailed(address);
        }

        @JavascriptInterface
        public String networkSignature() {
            return NetworkSignature.current();
        }

        /** The network changed: announce and look again */
        @JavascriptInterface
        public void restartDiscovery() {
            main.post(() -> {
                if (discovery == null || closed) return;
                Log.i(TAG, "the network changed: announcing and browsing again");
                discovery.restart();
            });
        }

        /** What this phone is called to the other devices */
        @JavascriptInterface
        public String deviceName() {
            return Build.MODEL;
        }

        /** Who made this phone, such as "google": the others show its logo */
        @JavascriptInterface
        public String deviceMaker() {
            return Build.MANUFACTURER == null ? "" : Build.MANUFACTURER.toLowerCase(Locale.ROOT);
        }

        /** Only a debug build may show what the page does with items */
        @JavascriptInterface
        public boolean isDebuggable() {
            return debuggable;
        }

        // --- the icons of the Mac apps items were copied from (AppIcons)

        /** Which of these app names (a JSON array) have no icon here, as a JSON
         *  array; none when the answer can't be made, so nothing is asked for */
        @JavascriptInterface
        public String missingAppIcons(String names) {
            try {
                JSONArray asked = new JSONArray(names);
                List<String> list = new ArrayList<>();
                for (int i = 0; i < asked.length(); i++) list.add(asked.optString(i, ""));
                return new JSONArray(appIcons().missing(list)).toString();
            } catch (JSONException | RuntimeException unreadable) {
                return "[]";
            }
        }

        /** Keep an app's icon (a png, base64). False when it isn't kept. */
        @JavascriptInterface
        public boolean saveAppIcon(String name, String png) {
            try {
                return appIcons().save(name, Base64.decode(png, Base64.DEFAULT));
            } catch (RuntimeException unreadable) {
                return false;
            }
        }

        // --- the history: answers are JSON text, see SyncStoreBridge

        @JavascriptInterface
        public String historyDeviceId() {
            return history.deviceId();
        }

        @JavascriptInterface
        public String historyEpoch() {
            return history.epoch();
        }

        @JavascriptInterface
        public String historyChangesAfter(double after, int limit) {
            return history.changesAfter((long) after, limit);
        }

        @JavascriptInterface
        public String historyRow(String id) {
            return history.row(id);
        }

        @JavascriptInterface
        public String historyNewestUnpinned(String skipped) {
            return history.newestUnpinned(skipped);
        }

        @JavascriptInterface
        public String historyPeer(String deviceId) {
            return history.peer(deviceId);
        }

        @JavascriptInterface
        public String historyLatestStamp() {
            return history.latestStamp();
        }

        @JavascriptInterface
        public String historyCommit(String batch) {
            return history.commit(batch);
        }

        @JavascriptInterface
        public String historyTrim() {
            return history.trimHistory();
        }

        @JavascriptInterface
        public String historySaveDetections(String detections, int version) {
            return history.saveDetections(detections, version);
        }

        /** Only a debug build may copy on the phone's behalf */
        @JavascriptInterface
        public String debugSaveText(String text) {
            return debuggable ? history.debugSaveText(text) : "{\"error\":\"not a debug build\"}";
        }

        @JavascriptInterface
        public void log(String line) {
            Log.i(TAG, "[page] " + line);
        }
    }

    // --- the web view: serves the page from the app's assets, and nothing else

    private final class Client extends WebViewClient {

        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            String path = PageAssets.pathFor(request.getUrl().toString());
            if (path != null) {
                try {
                    InputStream file = context.getAssets().open("public/" + path);
                    Map<String, String> headers = new HashMap<>();
                    headers.put("Cache-Control", "no-store");
                    return new WebResourceResponse(PageAssets.mimeType(path), "utf-8", 200, "OK", headers, file);
                } catch (IOException missing) {
                    Log.w(TAG, "the page asked for " + path + ", which is not in the app");
                }
            }
            // everything else: nothing. The page never reaches the network itself.
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return true; // the page stays where it is
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            Log.w(TAG, "the page's process is gone: crashed=" + detail.didCrash());
            main.post(() -> {
                if (closed || view != page) return;
                abandon();
                host.pageGone(detail.didCrash());
            });
            return true;
        }
    }

    /** Where the icons sync receives are kept, for the app's page to show */
    private AppIcons appIcons() {
        return new AppIcons(new File(context.getFilesDir(), AppIcons.FOLDER));
    }
}
