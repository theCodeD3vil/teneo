package com.michael.teneo.capture;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class CaptureRulesTest {

    private static final long COPIED = 1_763_000_000_000L;

    @Test
    public void aNewTextClipIsRead() {
        assertTrue(CaptureRules.shouldRead(true, false, COPIED, 0));
        assertTrue(CaptureRules.shouldRead(true, false, COPIED, COPIED - 1));
    }

    @Test
    public void theClipLastReadIsNotReadAgain() {
        assertFalse(CaptureRules.shouldRead(true, false, COPIED, COPIED));
    }

    @Test
    public void aSensitiveClipOrOneWithNoTextIsNeverRead() {
        assertFalse(CaptureRules.shouldRead(true, true, COPIED, 0));
        assertFalse(CaptureRules.shouldRead(false, false, COPIED, 0));
    }

    @Test
    public void aClipWithNoTimeIsAlwaysRead() {
        assertTrue(CaptureRules.shouldRead(true, false, 0, 0));
    }

    @Test
    public void aCopyDatesFromItsClipUnlessTheClipsTimeCantBeRight() {
        long now = COPIED + 60_000;
        assertEquals(COPIED, CaptureRules.dateCopied(COPIED, now));
        assertEquals(now, CaptureRules.dateCopied(now + 1, now));
        assertEquals(now, CaptureRules.dateCopied(0, now));
        assertEquals(now, CaptureRules.dateCopied(86_400_000L, now));
    }

    @Test
    public void teneosOwnClipIsToldByItsTextAndItsTime() {
        // the clip Teneo wrote, read back
        assertTrue(CaptureRules.isOwnWrite(true, COPIED, COPIED));
        // the same text copied again in another app, later
        assertFalse(CaptureRules.isOwnWrite(true, COPIED, COPIED + 60_000));
        // another text is never Teneo's
        assertFalse(CaptureRules.isOwnWrite(false, COPIED, COPIED));
    }

    @Test
    public void withoutATimeTheTextAloneDecides() {
        assertTrue(CaptureRules.isOwnWrite(true, 0, COPIED));
        assertTrue(CaptureRules.isOwnWrite(true, COPIED, 0));
    }

    @Test
    public void aClipWithNoTimeIsSavedOnceNotOnEveryFocus() {
        assertTrue(CaptureRules.isSameUntimedClip(0, true));
        assertFalse(CaptureRules.isSameUntimedClip(0, false));
        // a clip with a time is told apart by it, even with the same text
        assertFalse(CaptureRules.isSameUntimedClip(COPIED, true));
    }
}
