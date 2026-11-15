package com.michael.teneo.links;

import android.util.Base64;
import android.webkit.WebSettings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
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
        for (InetAddress resolved : InetAddress.getAllByName(url.getHost())) {
            if (LinkFetchRules.isLocal(resolved)) return result.put("blocked", true);
        }

        long deadline = System.currentTimeMillis() + DEADLINE_MS;
        HttpURLConnection connection = (HttpURLConnection) url.openConnection();
        try {
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", accept);
            connection.setRequestProperty("User-Agent", userAgent);
            int status = connection.getResponseCode();
            result.put("status", status);
            result.put("location", connection.getHeaderField("Location"));
            result.put("contentType", connection.getContentType());
            if (!LinkFetchRules.isSuccess(status)) return result;

            byte[] body = read(connection.getInputStream(), maxBytes, allowCut, deadline);
            if (body != null) result.put("body", Base64.encodeToString(body, Base64.NO_WRAP));
            return result;
        } finally {
            connection.disconnect();
        }
    }

    /** The first `maxBytes` of the answer, or null when it is longer and may not be cut */
    private static byte[] read(InputStream stream, int maxBytes, boolean allowCut, long deadline) throws IOException {
        try (InputStream in = stream) {
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            byte[] chunk = new byte[16 * 1024];
            while (body.size() < maxBytes) {
                if (System.currentTimeMillis() > deadline) throw new IOException("the site answers too slowly");
                int count = in.read(chunk, 0, Math.min(chunk.length, maxBytes - body.size()));
                if (count < 0) return body.toByteArray();
                body.write(chunk, 0, count);
            }
            // exactly as long as allowed, or longer?
            if (in.read() < 0 || allowCut) return body.toByteArray();
            return null;
        }
    }
}
