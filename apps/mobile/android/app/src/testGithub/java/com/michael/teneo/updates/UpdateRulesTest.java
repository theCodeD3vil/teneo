package com.michael.teneo.updates;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class UpdateRulesTest {

    private static final String APK =
        "https://github.com/theCodeD3vil/teneo/releases/download/android-v0.2.0/Teneo-0.2.0.apk";

    @Test
    public void downloadsOnlyAndroidReleaseApks() {
        assertTrue(UpdateRules.isReleaseUrl(APK));
        assertFalse(UpdateRules.isReleaseUrl(null));
        assertFalse(UpdateRules.isReleaseUrl(APK.replace("https:", "http:")));
        assertFalse(UpdateRules.isReleaseUrl("https://github.com/someone/teneo/releases/download/android-v0.2.0/Teneo.apk"));
        assertFalse(UpdateRules.isReleaseUrl("https://github.com/theCodeD3vil/teneo/releases/download/v0.2.0/Teneo.apk"));
        assertFalse(UpdateRules.isReleaseUrl(APK.replace(".apk", ".zip")));
        assertFalse(UpdateRules.isReleaseUrl(APK + "?x=1.apk"));
        assertFalse(UpdateRules.isReleaseUrl(APK.replace("0.2.0/", "0.2.0/../../x/")));
        assertFalse(UpdateRules.isReleaseUrl(APK.replace("0.2.0/", "0.2.0%2F..%2F")));
        assertFalse(UpdateRules.isReleaseUrl(APK.replace("Teneo", "Teneo app")));
    }

    @Test
    public void readsWholeNumbersHoweverTheBridgeSendsThem() {
        assertEquals(12, UpdateRules.wholeNumber(12));
        assertEquals(5_000_000_000L, UpdateRules.wholeNumber(5_000_000_000L));
        assertEquals(12, UpdateRules.wholeNumber(12.0));
        assertEquals(-1, UpdateRules.wholeNumber(12.5));
        assertEquals(-1, UpdateRules.wholeNumber(-3.0));
        assertEquals(-1, UpdateRules.wholeNumber("12"));
        assertEquals(-1, UpdateRules.wholeNumber(null));
    }

    @Test
    public void acceptsGitHubDigestsOrNone() {
        assertTrue(UpdateRules.isDigest(null));
        assertTrue(UpdateRules.isDigest("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"));
        assertFalse(UpdateRules.isDigest("0123456789ABCDEF0123456789abcdef0123456789abcdef0123456789abcdef"));
        assertFalse(UpdateRules.isDigest("abc"));
        assertFalse(UpdateRules.isDigest(""));
    }

    @Test
    public void writesHex() {
        assertEquals("00ff7f80", UpdateRules.hex(new byte[] { 0, (byte) 0xff, 0x7f, (byte) 0x80 }));
    }

    @Test
    public void installsOnlyTheNamedNewerVersionOfThisApp() {
        String self = "com.michael.teneo";
        assertNull(UpdateRules.archiveProblem(self, 2_000_099, self, 2_000_099, 1_000_001));
        assertEquals(
            "The download isn't an app Android can read",
            UpdateRules.archiveProblem(null, -1, self, 2_000_099, 1_000_001)
        );
        assertEquals(
            "The download is a different app",
            UpdateRules.archiveProblem("com.example", 2_000_099, self, 2_000_099, 1_000_001)
        );
        assertEquals(
            "The download isn't the version the release named",
            UpdateRules.archiveProblem(self, 2_000_001, self, 2_000_099, 1_000_001)
        );
        assertEquals(
            "This version of Teneo is already installed",
            UpdateRules.archiveProblem(self, 1_000_001, self, 1_000_001, 1_000_001)
        );
    }
}
