package com.michael.teneo.sync;

import java.util.Collections;
import java.util.Map;

/**
 * One-time changes to what an earlier version of the app saved, run before
 * sync reads anything. Each is marked done only once it has worked, so one
 * that failed is tried again on the next start.
 */
final class SyncMigrations {

    /** Which migrations have run */
    interface Flags {
        boolean isDone(String name);

        void markDone(String name);
    }

    /** The phone's saved settings */
    interface SavedSettings {
        Map<String, Object> read();

        void write(Map<String, Object> changes);
    }

    /**
     * Sync secrets used to default to on, and the app saves its defaults on
     * its first start, so a saved "on" from before can't be told from a
     * choice. Sync never ran in those versions, so turning it off loses
     * nothing the user saw work; it now defaults to off, like the Mac.
     */
    static final String SYNC_SECRETS_OFF = "migrated.syncSecretsOff";

    private SyncMigrations() {}

    static void run(Flags flags, SavedSettings settings) {
        if (flags.isDone(SYNC_SECRETS_OFF)) return;
        if (Boolean.TRUE.equals(settings.read().get(SyncController.SYNC_SECRETS))) {
            settings.write(Collections.singletonMap(SyncController.SYNC_SECRETS, false));
        }
        flags.markDone(SYNC_SECRETS_OFF);
    }
}
