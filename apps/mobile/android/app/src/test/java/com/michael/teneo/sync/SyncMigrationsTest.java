package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import org.junit.Test;

public class SyncMigrationsTest {

    private final Set<String> done = new HashSet<>();
    private final Map<String, Object> saved = new HashMap<>();
    private int writes;
    private boolean failWrite;

    private final SyncMigrations.Flags flags = new SyncMigrations.Flags() {
        @Override
        public boolean isDone(String name) {
            return done.contains(name);
        }

        @Override
        public void markDone(String name) {
            done.add(name);
        }
    };

    private final SyncMigrations.SavedSettings settings = new SyncMigrations.SavedSettings() {
        @Override
        public Map<String, Object> read() {
            return new HashMap<>(saved);
        }

        @Override
        public void write(Map<String, Object> changes) {
            if (failWrite) throw new IllegalStateException("database unavailable");
            writes++;
            saved.putAll(changes);
        }
    };

    @Test
    public void syncSecretsSavedOnByAnEarlierVersionIsTurnedOff() {
        saved.put("syncSecrets", true);
        saved.put("hideSecrets", true);
        SyncMigrations.run(flags, settings);
        assertEquals(false, saved.get("syncSecrets"));
        assertEquals("other settings are left alone", true, saved.get("hideSecrets"));
        assertTrue(done.contains(SyncMigrations.SYNC_SECRETS_OFF));
    }

    @Test
    public void itRunsOnceSoTurningItOnAfterwardsSticks() {
        saved.put("syncSecrets", true);
        SyncMigrations.run(flags, settings);
        saved.put("syncSecrets", true); // the user turns it on again
        SyncMigrations.run(flags, settings);
        assertEquals(true, saved.get("syncSecrets"));
        assertEquals(1, writes);
    }

    @Test
    public void offOrNeverSavedIsNotWritten() {
        SyncMigrations.run(flags, settings);
        assertFalse(saved.containsKey("syncSecrets"));
        done.clear();
        saved.put("syncSecrets", false);
        SyncMigrations.run(flags, settings);
        assertEquals(0, writes);
        assertTrue(done.contains(SyncMigrations.SYNC_SECRETS_OFF));
    }

    @Test
    public void aFailedWriteIsTriedAgainOnTheNextStart() {
        saved.put("syncSecrets", true);
        failWrite = true;
        try {
            SyncMigrations.run(flags, settings);
            fail("the failure reaches the caller, which logs it");
        } catch (IllegalStateException expected) {
            // as the database said
        }
        assertFalse(done.contains(SyncMigrations.SYNC_SECRETS_OFF));
        failWrite = false;
        SyncMigrations.run(flags, settings);
        assertEquals(false, saved.get("syncSecrets"));
        assertTrue(done.contains(SyncMigrations.SYNC_SECRETS_OFF));
    }
}
