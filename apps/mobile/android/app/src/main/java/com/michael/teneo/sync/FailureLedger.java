package com.michael.teneo.sync;

import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.function.LongSupplier;

/**
 * Remembers which addresses failed a handshake lately. An address that fails
 * too often within the window is refused until its oldest failure ages out:
 * the Mac's rule (failureLimit in lan-transport.ts).
 */
final class FailureLedger {

    /** Enough for any real network; an address that spoofs many can't grow it */
    private static final int MAX_ADDRESSES = 256;

    private final int count;
    private final long windowMs;
    private final LongSupplier clock;
    private final Map<String, ArrayDeque<Long>> failures = new HashMap<>();

    FailureLedger(int count, long windowMs, LongSupplier clock) {
        this.count = count;
        this.windowMs = windowMs;
        this.clock = clock;
    }

    synchronized void record(String address) {
        if (failures.size() >= MAX_ADDRESSES && !failures.containsKey(address)) prune();
        if (failures.size() >= MAX_ADDRESSES && !failures.containsKey(address)) return;
        failures.computeIfAbsent(address, key -> new ArrayDeque<>()).add(clock.getAsLong());
    }

    synchronized boolean isBlocked(String address) {
        ArrayDeque<Long> times = failures.get(address);
        if (times == null) return false;
        dropOld(times);
        if (times.isEmpty()) {
            failures.remove(address);
            return false;
        }
        return times.size() >= count;
    }

    private void prune() {
        for (Iterator<ArrayDeque<Long>> it = failures.values().iterator(); it.hasNext(); ) {
            ArrayDeque<Long> times = it.next();
            dropOld(times);
            if (times.isEmpty()) it.remove();
        }
    }

    private void dropOld(ArrayDeque<Long> times) {
        long since = clock.getAsLong() - windowMs;
        while (!times.isEmpty() && times.peekFirst() <= since) times.removeFirst();
    }
}
