package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import org.junit.Test;

public class KnownDevicesTest {

    private static KnownDevices.Peer mac() {
        return new KnownDevices.Peer("mac-1", "Michael's MacBook", "mac");
    }

    @Test
    public void aConnectedPeerIsListedAsConnected() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        assertTrue(devices.connected(Arrays.asList(mac()), 100));
        List<KnownDevices.Device> list = devices.list();
        assertEquals(1, list.size());
        assertEquals("Michael's MacBook", list.get(0).name);
        assertEquals("mac", list.get(0).platform);
        assertTrue(list.get(0).connected);
        assertEquals(100, list.get(0).lastSeen);
        assertTrue(devices.anyConnected());
    }

    @Test
    public void theSameReportTwiceChangesNothing() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        assertFalse(devices.connected(Arrays.asList(mac()), 200));
    }

    @Test
    public void aPeerThatLeavesIsKeptWithWhenItWasLastSeen() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        assertTrue(devices.connected(new ArrayList<>(), 500));
        KnownDevices.Device device = devices.list().get(0);
        assertFalse(device.connected);
        assertEquals(500, device.lastSeen);
        assertFalse(devices.anyConnected());
    }

    @Test
    public void stoppingEndsEveryConnection() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac(), new KnownDevices.Peer("mac-2", "Studio", "mac")), 100);
        assertTrue(devices.allGone(300));
        for (KnownDevices.Device device : devices.list()) {
            assertFalse(device.connected);
            assertEquals(300, device.lastSeen);
        }
        assertFalse("already gone", devices.allGone(400));
    }

    @Test
    public void aPeerWithoutANameKeepsTheOneItHad() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        devices.allGone(200);
        devices.connected(Arrays.asList(new KnownDevices.Peer("mac-1", "", null)), 300);
        KnownDevices.Device device = devices.list().get(0);
        assertEquals("Michael's MacBook", device.name);
        assertEquals("mac", device.platform);
        assertTrue(device.connected);
    }

    @Test
    public void aRenamedPeerIsUpdated() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        assertTrue(devices.connected(Arrays.asList(new KnownDevices.Peer("mac-1", "Work Mac", "mac")), 200));
        assertEquals("Work Mac", devices.list().get(0).name);
    }

    @Test
    public void storedDevicesAreNotConnectedAndPeersWithoutAnIdAreIgnored() {
        KnownDevices devices = new KnownDevices(Arrays.asList(
            new KnownDevices.Device("mac-1", "Mac", "mac", 50, true),
            new KnownDevices.Device("", "No id", "mac", 60, false)
        ));
        assertEquals(1, devices.list().size());
        assertFalse(devices.list().get(0).connected);
        assertFalse(devices.connected(Arrays.asList(new KnownDevices.Peer(null, "x", "mac")), 70));
        assertEquals(1, devices.list().size());
    }

    @Test
    public void connectedComeFirstThenMostRecentlySeen() {
        KnownDevices devices = new KnownDevices(Arrays.asList(
            new KnownDevices.Device("old", "Old", "mac", 10, false),
            new KnownDevices.Device("recent", "Recent", "mac", 90, false)
        ));
        devices.connected(Arrays.asList(new KnownDevices.Peer("now", "Now", "mac")), 50);
        List<KnownDevices.Device> list = devices.list();
        assertEquals("now", list.get(0).id);
        assertEquals("recent", list.get(1).id);
        assertEquals("old", list.get(2).id);
    }

    @Test
    public void theListIsCappedByForgettingTheOneSeenLongestAgo() {
        List<KnownDevices.Device> stored = new ArrayList<>();
        for (int i = 0; i < KnownDevices.MAX + 5; i++) stored.add(new KnownDevices.Device("d" + i, "D" + i, "mac", 1000 + i, false));
        KnownDevices devices = new KnownDevices(stored);
        assertEquals(KnownDevices.MAX, devices.list().size());
        for (KnownDevices.Device device : devices.list()) assertTrue(device.lastSeen >= 1005);
    }

    @Test
    public void clearForgetsEverything() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        devices.clear();
        assertEquals(0, devices.list().size());
    }
}
