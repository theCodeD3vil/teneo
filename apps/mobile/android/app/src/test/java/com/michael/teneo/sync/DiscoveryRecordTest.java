package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertNull;

import java.util.HashMap;
import java.util.Map;
import org.junit.Test;

public class DiscoveryRecordTest {

    private static final String KEY = "ab".repeat(32);
    private static final String DEVICE = "0123456789abcdef0123456789abcdef";

    @Test
    public void matchesTheVectorTheMacUses() {
        // packages/sync/src/discovery-record.test.ts, checked with Python's hmac too
        DiscoveryRecord record = DiscoveryRecord.make(KEY, DEVICE, "00112233aabbccdd");
        assertEquals("teneo-00112233aabbccdd", record.instance);
        assertEquals("00112233aabbccdd", record.txt.get("s"));
        assertEquals("ee39c34e236fbdb3", record.txt.get("vt"));
        assertEquals("775e94fc09aaa329a38270332cce2cc5", record.txt.get("dev"));
    }

    @Test
    public void onlyTheVaultReadsTheIdBack() {
        DiscoveryRecord record = DiscoveryRecord.make(KEY, DEVICE, DiscoveryRecord.newSalt());
        assertEquals(DEVICE, DiscoveryRecord.read(KEY, record.txt));
        assertNull(DiscoveryRecord.read("cd".repeat(32), record.txt));
        Map<String, String> forged = new HashMap<>(record.txt);
        forged.put("vt", "0".repeat(16));
        assertNull(DiscoveryRecord.read(KEY, forged));
        Map<String, String> versionOne = new HashMap<>();
        versionOne.put("vt", "a".repeat(16));
        versionOne.put("dev", DEVICE);
        assertNull(DiscoveryRecord.read(KEY, versionOne));
    }

    @Test
    public void saysNothingTheSameTwice() {
        DiscoveryRecord first = DiscoveryRecord.make(KEY, DEVICE, DiscoveryRecord.newSalt());
        DiscoveryRecord second = DiscoveryRecord.make(KEY, DEVICE, DiscoveryRecord.newSalt());
        assertNotEquals(first.instance, second.instance);
        assertNotEquals(first.txt.get("dev"), second.txt.get("dev"));
        assertFalse(first.txt.toString().contains(DEVICE.substring(0, 12)));
    }
}
