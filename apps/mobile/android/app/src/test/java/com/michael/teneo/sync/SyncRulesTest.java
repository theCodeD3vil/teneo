package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import com.michael.teneo.sync.SyncRules.Mode;
import org.junit.Test;

public class SyncRulesTest {

    @Test
    public void nothingRunsUntilPaired() {
        assertEquals(Mode.OFF, SyncRules.mode(false, true, true));
        assertEquals(Mode.OFF, SyncRules.mode(false, true, false));
        assertEquals(Mode.OFF, SyncRules.mode(false, false, true));
        assertEquals(Mode.OFF, SyncRules.mode(false, false, false));
    }

    @Test
    public void backgroundReceiveRunsAForegroundServiceWhetherOrNotTheAppIsOpen() {
        assertEquals(Mode.BACKGROUND, SyncRules.mode(true, true, true));
        assertEquals(Mode.BACKGROUND, SyncRules.mode(true, true, false));
    }

    @Test
    public void withoutBackgroundReceiveItRunsOnlyWhileTheAppIsOnScreen() {
        assertEquals(Mode.WITH_APP, SyncRules.mode(true, false, true));
        assertEquals(Mode.OFF, SyncRules.mode(true, false, false));
    }

    @Test
    public void afterARebootItComesBackOnlyIfPairedWithBackgroundReceiveOn() {
        assertTrue(SyncRules.startsUnattended(true, true));
        assertFalse(SyncRules.startsUnattended(true, false));
        assertFalse(SyncRules.startsUnattended(false, true));
        assertFalse(SyncRules.startsUnattended(false, false));
    }
}
