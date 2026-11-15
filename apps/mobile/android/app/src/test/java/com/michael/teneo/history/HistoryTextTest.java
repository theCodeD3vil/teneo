package com.michael.teneo.history;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertSame;
import static org.junit.Assert.assertTrue;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

// The cases of apps/desktop/backend/history-query.test.ts, so the phone cuts
// and searches as the Mac does
public class HistoryTextTest {

    private static final int LIMIT = HistoryText.PREVIEW_LENGTH;

    @Test
    public void aShortTextIsPassedThroughWhole() {
        HistoryText.Preview preview = HistoryText.truncate("hello", Collections.emptyList(), 5, LIMIT);
        assertEquals("hello", preview.text);
        assertFalse(preview.isTruncated);
    }

    @Test
    public void aLongTextIsCutAndTheSecretsAfterTheCutDropped() {
        String text = "a".repeat(1500);
        SecretSpan early = new SecretSpan(10, 20, "key");
        List<SecretSpan> secrets = Arrays.asList(early, new SecretSpan(1200, 1210, "key"));
        HistoryText.Preview preview = HistoryText.truncate(text, secrets, text.length(), LIMIT);
        assertEquals(1000, preview.text.length());
        assertEquals(1, preview.secrets.size());
        assertSame(early, preview.secrets.get(0));
        assertTrue(preview.isTruncated);
    }

    @Test
    public void theCutMovesBeforeASecretItWouldSplit() {
        String text = "x".repeat(1500);
        List<SecretSpan> secrets = Collections.singletonList(new SecretSpan(990, 1030, "token"));
        HistoryText.Preview preview = HistoryText.truncate(text, secrets, text.length(), LIMIT);
        assertEquals(990, preview.text.length());
        assertTrue(preview.secrets.isEmpty());
    }

    @Test
    public void aTextSqliteAlreadyShortenedIsMarkedAsTruncated() {
        HistoryText.Preview preview = HistoryText.truncate("abc", Collections.emptyList(), 5000, LIMIT);
        assertTrue(preview.isTruncated);
        assertEquals("abc", preview.text);
    }

    @Test
    public void theCutNeverSplitsASurrogatePair() {
        // an emoji is two chars; one straddling the cut is left out whole
        String text = "a".repeat(999) + "\uD83D\uDE00" + "b".repeat(10);
        HistoryText.Preview preview = HistoryText.truncate(text, Collections.emptyList(), 1010, LIMIT);
        assertEquals(999, preview.text.length());
    }

    @Test
    public void likePatternsEscapeSqliteWildcards() {
        assertEquals("%50\\%\\_a\\\\%", HistoryText.likePattern("50%_A\\"));
    }

    private static final String KEY_TEXT = "token " + "k".repeat(30) + "1234 for ci";
    private static final List<SecretSpan> KEY = Collections.singletonList(new SecretSpan(6, 40, "GitHub token"));

    @Test
    public void aHiddenKeyIsFoundByItsKindAndTailNotItsBody() {
        assertTrue(HistoryText.matchesSearch(KEY_TEXT, KEY, "Terminal", null, "github token", true));
        assertTrue(HistoryText.matchesSearch(KEY_TEXT, KEY, "Terminal", null, "1234", true));
        assertFalse(HistoryText.matchesSearch(KEY_TEXT, KEY, "Terminal", null, "kkkkk", true));
        assertTrue(HistoryText.matchesSearch(KEY_TEXT, KEY, "Terminal", null, "for ci", true));
    }

    @Test
    public void withHidingOffTheKeyItselfIsSearchable() {
        assertTrue(HistoryText.matchesSearch(KEY_TEXT, KEY, "Terminal", null, "kkkkk", false));
    }

    @Test
    public void theSourceAppAndLinkHostAreSearched() {
        List<SecretSpan> none = Collections.emptyList();
        assertTrue(HistoryText.matchesSearch("x", none, "Terminal", null, "termi", true));
        assertTrue(HistoryText.matchesSearch("x", none, null, "example.org", "example", true));
        assertFalse(HistoryText.matchesSearch("x", none, "Terminal", "example.org", "safari", true));
    }

    @Test
    public void aShortSecretIsMaskedWhole() {
        assertEquals("********", HistoryText.maskSecret("short"));
        assertEquals("********wxyz", HistoryText.maskSecret("abcdefghijklmnopwxyz"));
    }
}
