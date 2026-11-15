package com.michael.teneo.history;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.Map;
import org.junit.Test;

public class SettingsTest {

    @Test
    public void onlyKnownSettingsOfTheRightTypeAreKept() {
        Map<String, Object> changes = new HashMap<>();
        changes.put("hideSecrets", false);
        changes.put("maxItems", 1000);
        changes.put("historyRetentionDays", 7.0);
        changes.put("captureOnOpen", "yes");
        changes.put("unknown", true);
        Map<String, Object> expected = new LinkedHashMap<>();
        expected.put("hideSecrets", false);
        expected.put("maxItems", 1000L);
        expected.put("historyRetentionDays", 7L);
        assertEquals(expected, Settings.sanitize(changes));
    }

    @Test
    public void aCountIsAWholeNumberZeroOrMore() {
        for (Object bad : new Object[] { -1, 1.5, Double.NaN, Double.POSITIVE_INFINITY, 2e12 }) {
            Map<String, Object> changes = new HashMap<>();
            changes.put("maxItems", bad);
            assertEquals(String.valueOf(bad), 0, Settings.sanitize(changes).size());
        }
    }

    @Test
    public void aStoredSettingReadsBackAsItsType() {
        assertEquals(true, Settings.parse("hideSecrets", Settings.format(true)));
        assertEquals(false, Settings.parse("captureOnOpen", "false"));
        assertEquals(500L, Settings.parse("maxItems", Settings.format(500L)));
        assertNull(Settings.parse("maxItems", "lots"));
        assertNull(Settings.parse("maxItems", "-3"));
        assertNull(Settings.parse("hideSecrets", "1"));
        assertNull(Settings.parse("unknown", "true"));
    }

    @Test
    public void aMissingSettingFallsBack() {
        Map<String, Object> none = new HashMap<>();
        assertEquals(30, Settings.count(none, Settings.HISTORY_RETENTION_DAYS, Settings.DEFAULT_HISTORY_RETENTION_DAYS));
        assertEquals(true, Settings.bool(none, Settings.HIDE_SECRETS, Settings.DEFAULT_HIDE_SECRETS));
    }
}
