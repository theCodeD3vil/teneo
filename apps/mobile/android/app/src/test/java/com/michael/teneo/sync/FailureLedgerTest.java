package com.michael.teneo.sync;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.atomic.AtomicLong;
import org.junit.Test;

public class FailureLedgerTest {

    private final AtomicLong now = new AtomicLong(1_000_000);
    private final FailureLedger ledger = new FailureLedger(5, 60_000, now::get);

    @Test
    public void anAddressIsRefusedAfterFiveFailuresInTheWindow() {
        for (int i = 0; i < 4; i++) {
            ledger.record("10.0.0.2");
            now.addAndGet(1000);
        }
        assertFalse(ledger.isBlocked("10.0.0.2"));
        ledger.record("10.0.0.2");
        assertTrue(ledger.isBlocked("10.0.0.2"));
        assertFalse("another address is not affected", ledger.isBlocked("10.0.0.3"));
    }

    @Test
    public void failuresAgeOut() {
        for (int i = 0; i < 5; i++) ledger.record("10.0.0.2");
        assertTrue(ledger.isBlocked("10.0.0.2"));
        now.addAndGet(60_001);
        assertFalse(ledger.isBlocked("10.0.0.2"));
    }

    @Test
    public void spreadOutFailuresNeverAddUp() {
        for (int i = 0; i < 20; i++) {
            ledger.record("10.0.0.2");
            now.addAndGet(20_000); // three fit in a window
            assertFalse(ledger.isBlocked("10.0.0.2"));
        }
    }

    @Test
    public void manyAddressesCannotGrowItWithoutEnd() {
        for (int i = 0; i < 5000; i++) ledger.record("10.1." + (i / 250) + "." + (i % 250));
        // still answers, and an address already in it keeps counting
        for (int i = 0; i < 5; i++) ledger.record("10.1.0.0");
        assertTrue(ledger.isBlocked("10.1.0.0"));
    }
}
