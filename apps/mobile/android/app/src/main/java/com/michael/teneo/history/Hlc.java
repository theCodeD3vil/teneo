package com.michael.teneo.history;

import java.util.Locale;
import java.util.regex.Pattern;

/**
 * The hybrid logical clock that stamps pins, as packages/sync/src/hlc.ts makes
 * them: 12 hex digits of milliseconds, 4 of counter, then the device id. Plain
 * string comparison orders stamps, and once a stamp has been seen every stamp
 * made afterwards is larger.
 */
public final class Hlc {

    public interface Clock {
        long now();
    }

    private static final Pattern STAMP = Pattern.compile("^[0-9a-f]{12}-[0-9a-f]{4}-[0-9a-f]{32}$");
    private static final Pattern DEVICE_ID = Pattern.compile("^[0-9a-f]{32}$");
    private static final int MAX_COUNTER = 0xffff;

    private final String deviceId;
    private final Clock clock;
    private long wall = 0;
    private int counter = 0;

    public Hlc(String deviceId, Clock clock) {
        if (!isDeviceId(deviceId)) throw new IllegalArgumentException("A device id is 32 hex digits");
        this.deviceId = deviceId;
        this.clock = clock;
    }

    public static boolean isDeviceId(String value) {
        return value != null && DEVICE_ID.matcher(value).matches();
    }

    public static boolean isStamp(String value) {
        return value != null && STAMP.matcher(value).matches();
    }

    /** The stamp for a change made on this device now */
    public synchronized String next() {
        long nextWall = Math.max(wall, clock.now());
        counter = nextWall == wall ? counter + 1 : 0;
        wall = nextWall;
        if (counter > MAX_COUNTER) {
            wall += 1;
            counter = 0;
        }
        return String.format(Locale.ROOT, "%012x-%04x-%s", wall, counter, deviceId);
    }

    /** Learn a stamp made elsewhere, so the next one is larger than it */
    public synchronized void observe(String stamp) {
        if (!isStamp(stamp)) return;
        long seenWall = Long.parseLong(stamp.substring(0, 12), 16);
        int seenCounter = Integer.parseInt(stamp.substring(13, 17), 16);
        if (seenWall > wall) {
            wall = seenWall;
            counter = seenCounter;
        } else if (seenWall == wall) {
            counter = Math.max(counter, seenCounter);
        }
    }
}
