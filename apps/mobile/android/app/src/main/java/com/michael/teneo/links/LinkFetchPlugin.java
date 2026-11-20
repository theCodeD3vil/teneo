package com.michael.teneo.links;

import android.util.Base64;
import android.webkit.WebSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.net.InetAddress;
import java.net.MalformedURLException;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Asks a site for one page or picture, for link previews. The app's page
 * can't read other sites, so it asks here and does the rest itself
 * (src/previews/link-previews.ts): it follows each redirect only after
 * checking where it leads, so none is followed here.
 */
@CapacitorPlugin(name = "LinkFetch")
public class LinkFetchPlugin extends Plugin {

    private static final int TIMEOUT_MS = 8000;
    /** A site that keeps sending slowly is given up on */
    private static final long DEADLINE_MS = 15_000;

    // a list full of new links asks for several at once; the page allows four
    private final ExecutorService requests = Executors.newFixedThreadPool(4);
    private String userAgent;

    @Override
    public void load() {
        // some sites turn away requests that don't look like a browser
        String browser;
        try {
            browser = WebSettings.getDefaultUserAgent(getContext());
        } catch (RuntimeException noWebView) {
            browser = "Mozilla/5.0 (Linux; Android) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Mobile Safari/537.36";
        }
        userAgent = browser + " Teneo";
    }

    @Override
    protected void handleOnDestroy() {
        requests.shutdownNow();
    }

    /**
     * GET `url`. Resolves with `blocked` for an address a preview is never
     * fetched from, else with the status, the redirect's `location`, the
     * `contentType` and, for a success no longer than `maxBytes` (or cut to
     * it with `allowCut`), the `body` in base64. Rejects when the site can't
     * be reached, so the page tries again later.
     */
    @PluginMethod
    public void get(PluginCall call) {
        String address = call.getString("url");
        String accept = call.getString("accept", "*/*");
        int maxBytes = LinkFetchRules.byteLimit(call.getInt("maxBytes"));
        boolean allowCut = Boolean.TRUE.equals(call.getBoolean("allowCut", false));
        if (address == null || maxBytes == 0) {
            call.reject("A url and maxBytes are needed");
            return;
        }
        requests.execute(() -> {
            try {
                call.resolve(fetch(address, accept, maxBytes, allowCut));
            } catch (IOException | RuntimeException error) {
                call.reject("Couldn't reach the site", error);
            }
        });
    }

    private JSObject fetch(String address, String accept, int maxBytes, boolean allowCut) throws IOException {
        JSObject result = new JSObject();
        URL url;
        try {
            url = new URL(address);
        } catch (MalformedURLException notAnAddress) {
            return result.put("blocked", true);
        }
        if (!LinkFetchRules.isWebAddress(url)) return result.put("blocked", true);
        InetAddress[] resolved = InetAddress.getAllByName(url.getHost());
        for (InetAddress candidate : resolved) {
            if (LinkFetchRules.isLocal(candidate)) return result.put("blocked", true);
        }

        // to the addresses just checked and no other: looking the name up
        // again could answer differently (PinnedHttp)
        long deadline = System.currentTimeMillis() + DEADLINE_MS;
        IOException failure = new IOException("The site has no address");
        for (InetAddress candidate : resolved) {
            PinnedHttp.Response response;
            try {
                response = PinnedHttp.get(PinnedHttp.NETWORK, url, candidate, accept, userAgent, maxBytes, allowCut, deadline, TIMEOUT_MS);
            } catch (java.net.ConnectException | java.net.NoRouteToHostException unreachable) {
                failure = unreachable;
                continue;
            } catch (IllegalArgumentException notSent) {
                return result.put("blocked", true);
            }
            result.put("status", response.status);
            result.put("location", response.location);
            result.put("contentType", response.contentType);
            if (response.body != null) result.put("body", Base64.encodeToString(response.body, Base64.NO_WRAP));
            return result;
        }
        throw failure;
    }
}
