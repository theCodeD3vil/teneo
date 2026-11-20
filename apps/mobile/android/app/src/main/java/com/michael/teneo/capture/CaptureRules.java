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
     * for none. A clip with no time is always read, and told from the last
     * one by its text (isSameUntimedClip).
     */
    static boolean shouldRead(boolean isText, boolean isSensitive, long copiedAt, long seenAt) {
        if (!isText || isSensitive) return false;
        return copiedAt == 0 || copiedAt != seenAt;
    }

    /**
     * Whether the clip just read is the one Teneo itself put on the clipboard.
     * The text must be what Teneo wrote, and so must the clip: `writtenAt` is
     * the time Android gave Teneo's clip, `copiedAt` this one's. The same text
     * copied again in another app has a later time and is the user's own
     * copy. Where either time is unknown (0), the text alone decides.
     */
    static boolean isOwnWrite(boolean isWrittenText, long writtenAt, long copiedAt) {
        if (!isWrittenText) return false;
        return writtenAt == 0 || copiedAt == 0 || writtenAt == copiedAt;
    }

    /**
     * Whether a clip with no time is the one read last time. Such a clip is
     * read on every focus, as nothing else tells a new one from the old; the
     * same text again is then the same clip, and is not saved again.
     */
    static boolean isSameUntimedClip(long copiedAt, boolean isSeenText) {
        return copiedAt == 0 && isSeenText;
    }

    /**
     * Whether a clip's or a share's image is another app's to hand over: a
     * content:// address of a provider that isn't Teneo's. Teneo reads it
     * with its own rights, so a file:// path, or an address of one of its own
     * providers, would let any app have Teneo read out (and sync) Teneo's
     * private files. `authority` may carry a user ("10@authority").
     */
    static boolean isOtherAppsContent(String scheme, String authority, String packageName) {
        if (!"content".equalsIgnoreCase(scheme) || authority == null || packageName == null) return false;
        String provider = authority.substring(authority.lastIndexOf('@') + 1).trim().toLowerCase(java.util.Locale.ROOT);
        String own = packageName.toLowerCase(java.util.Locale.ROOT);
        return !provider.isEmpty() && !provider.equals(own) && !provider.startsWith(own + ".");
    }

    /** The longest side an image Teneo draws again (one it can't keep as it is) may have */
    static final int MAX_REDRAWN_SIDE = 4096;

    /** The BitmapFactory sample size (a power of two) that brings an image of
     *  this size within MAX_REDRAWN_SIDE */
    static int sampleSize(int width, int height) {
        int size = 1;
        while (Math.max(width, height) / size > MAX_REDRAWN_SIDE) size *= 2;
        return size;
    }

    /** When a clip saved `now` was copied */
    static long dateCopied(long copiedAt, long now) {
        return copiedAt >= EARLIEST_CLIP_TIME && copiedAt <= now ? copiedAt : now;
    }
}
