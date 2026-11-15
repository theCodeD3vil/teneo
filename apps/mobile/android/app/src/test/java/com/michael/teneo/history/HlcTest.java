package com.michael.teneo.history;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import org.junit.Test;

// The cases of packages/sync/src/hlc.test.ts: the phone's stamps have to
// order with the Mac's
public class HlcTest {

    private static final String A = "a".repeat(32);
    private static final String B = "b".repeat(32);

    @Test
    public void stampsKeepRisingWhenTheClockStandsStillOrGoesBack() {
        long[] time = { 1000 };
        Hlc clock = new Hlc(A, () -> time[0]);
        List<String> stamps = new ArrayList<>(Arrays.asList(clock.next(), clock.next()));
        time[0] = 500;
        stamps.add(clock.next());
        time[0] = 5000;
        stamps.add(clock.next());
        for (String stamp : stamps) assertTrue(stamp, Hlc.isStamp(stamp));
        List<String> sorted = new ArrayList<>(stamps);
        sorted.sort(null);
        assertEquals(stamps, sorted);
        assertEquals(4, new HashSet<>(stamps).size());
    }

    @Test
    public void aStampIsTheMacsFormat() {
        Hlc clock = new Hlc(A, () -> 0x1234L);
        assertEquals("000000001234-0000-" + A, clock.next());
        assertEquals("000000001234-0001-" + A, clock.next());
    }

    @Test
    public void afterSeeingAStampFromTheFutureTheNextIsLarger() {
        Hlc behind = new Hlc(A, () -> 1000);
        Hlc ahead = new Hlc(B, () -> 9_000_000);
        String remote = ahead.next();
        behind.observe(remote);
        assertTrue(behind.next().compareTo(remote) > 0);
        behind.observe(remote);
        assertTrue(Hlc.isStamp(behind.next()));
    }

    @Test
    public void twoDevicesNeverMakeTheSameStamp() {
        Hlc x = new Hlc(A, () -> 1000);
        Hlc y = new Hlc(B, () -> 1000);
        assertEquals(4, new HashSet<>(Arrays.asList(x.next(), y.next(), x.next(), y.next())).size());
    }

    @Test
    public void aCounterThatRunsOutMovesTheTimeOn() {
        Hlc clock = new Hlc(A, () -> 1000);
        String last = clock.next();
        for (int i = 0; i < 70_000; i++) {
            String next = clock.next();
            assertTrue(next.compareTo(last) > 0);
            last = next;
        }
    }

    @Test
    public void onlyWellFormedStampsAndIdsAreAccepted() {
        assertFalse(Hlc.isStamp("nope"));
        assertFalse(Hlc.isStamp(null));
        assertThrows(IllegalArgumentException.class, () -> new Hlc("short", () -> 0));
        new Hlc(A, () -> 0).observe("garbage");
    }
}
