package com.michael.teneo.sync;

import java.util.regex.Pattern;

/**
 * Which files the sync page may load, and as what. The page is served from
 * the app's own assets under a made-up https address; nothing else is ever
 * served, and the page can't reach the network by itself.
 */
final class PageAssets {

    /** The page is served from here: https, so it is a secure context and has
     *  WebCrypto. The name is never looked up, every request is answered by us. */
    static final String ORIGIN = "https://teneo-sync.invalid/";

    /** The page itself, and the files Vite built for it: one folder, plain names */
    private static final Pattern SERVED = Pattern.compile("^(sync\\.html|assets/[A-Za-z0-9._-]+)$");

    private PageAssets() {}

    /** The path under the web folder that `url` asks for, or null when it may not have one */
    static String pathFor(String url) {
        if (!url.startsWith(ORIGIN)) return null;
        String path = url.substring(ORIGIN.length()).replaceFirst("[?#].*$", "");
        // a name made only of dots would be a way up out of the folder
        if (path.contains("..") || !SERVED.matcher(path).matches()) return null;
        return path;
    }

    static String mimeType(String path) {
        if (path.endsWith(".html")) return "text/html";
        if (path.endsWith(".js")) return "text/javascript";
        if (path.endsWith(".css")) return "text/css";
        if (path.endsWith(".map") || path.endsWith(".json")) return "application/json";
        return "application/octet-stream";
    }
}
