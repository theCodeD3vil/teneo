package com.michael.teneo.sync;

/**
 * When sync runs, and how. It runs while the phone is paired and either
 * "Receive in the background" is on, or the app is on screen:
 *
 *   - background receive on: a foreground service, with its notification,
 *     that outlives the app, comes back after a reboot and after the system
 *     ends it
 *   - background receive off: a plain service while the app is on screen,
 *     with no notification, stopped when the app leaves the screen; nothing
 *     starts it at boot
 */
public final class SyncRules {

    public enum Mode {
        OFF,
        /** Only while the app is on screen: no notification */
        WITH_APP,
        /** In the background too: a foreground service */
        BACKGROUND,
    }

    private SyncRules() {}

    public static Mode mode(boolean paired, boolean backgroundReceive, boolean appVisible) {
        if (!paired) return Mode.OFF;
        if (backgroundReceive) return Mode.BACKGROUND;
        return appVisible ? Mode.WITH_APP : Mode.OFF;
    }

    /** After a reboot or an app update, with the app not open */
    public static boolean startsUnattended(boolean paired, boolean backgroundReceive) {
        return mode(paired, backgroundReceive, false) != Mode.OFF;
    }
}
