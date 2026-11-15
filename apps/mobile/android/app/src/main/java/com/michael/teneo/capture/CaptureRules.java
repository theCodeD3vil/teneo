package com.michael.teneo.capture;

/** The capture's choices that need nothing of Android, so the JVM tests reach them */
final class CaptureRules {

    // A clip's time is the phone's clock when it was copied. One before this
    // can't be that, so the copy counts as made when Teneo saw it.
    static final long EARLIEST_CLIP_TIME = 1_577_836_800_000L; // 2020-01-01

    private CaptureRules() {}

    /**
     * Whether a clip is worth reading. Reading is what makes Android show
     * "Teneo pasted from your clipboard", so it waits for a text, not marked
     * sensitive (as password managers mark theirs), that Teneo hasn't already
     * looked at: `copiedAt` is the clip's time, `seenAt` the last one read, 0
     * for none. A clip with no time is always read; saving it again only
     * bumps it.
     */
    static boolean shouldRead(boolean isText, boolean isSensitive, long copiedAt, long seenAt) {
        if (!isText || isSensitive) return false;
        return copiedAt == 0 || copiedAt != seenAt;
    }

    /** When a clip saved `now` was copied */
    static long dateCopied(long copiedAt, long now) {
        return copiedAt >= EARLIEST_CLIP_TIME && copiedAt <= now ? copiedAt : now;
    }
}
