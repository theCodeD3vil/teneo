package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class PageAssetsTest {

    private static String path(String suffix) {
        return PageAssets.pathFor(PageAssets.ORIGIN + suffix);
    }

    @Test
    public void thePageAndItsBuiltFilesAreServed() {
        assertEquals("sync.html", path("sync.html"));
        assertEquals("assets/sync-Cn7xeASZ.js", path("assets/sync-Cn7xeASZ.js"));
        assertEquals("assets/common-D9hQo0es.js", path("assets/common-D9hQo0es.js?v=1#top"));
    }

    @Test
    public void nothingElseIs() {
        assertNull(path(""));
        assertNull(path("index.html"));
        assertNull(path("assets/"));
        assertNull(path("assets/nested/file.js"));
        assertNull(path("capacitor.config.json"));
        assertNull(path("sync.html/extra"));
    }

    @Test
    public void aWayUpOutOfTheFolderIsRefusedHoweverItIsWritten() {
        assertNull(path("assets/../capacitor.config.json"));
        assertNull(path("assets/.."));
        assertNull(path("assets/..%2Fcapacitor.config.json"));
        assertNull(path("assets/%2e%2e/x"));
        assertNull(path("../sync.html"));
        assertNull(path("assets/a..js"));
    }

    @Test
    public void anotherAddressIsNotOurs() {
        assertNull(PageAssets.pathFor("https://example.com/sync.html"));
        assertNull(PageAssets.pathFor("http://teneo-sync.invalid/sync.html"));
        assertNull(PageAssets.pathFor("https://teneo-sync.invalid.evil.com/sync.html"));
    }

    @Test
    public void typesAreByExtension() {
        assertEquals("text/html", PageAssets.mimeType("sync.html"));
        assertEquals("text/javascript", PageAssets.mimeType("assets/a.js"));
        assertEquals("text/css", PageAssets.mimeType("assets/a.css"));
        assertEquals("application/octet-stream", PageAssets.mimeType("assets/a.bin"));
    }
}
