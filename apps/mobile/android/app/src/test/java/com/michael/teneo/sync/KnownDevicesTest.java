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

    // --- disconnecting a device

    private static KnownDevices.Peer mac(String pairing) {
        return new KnownDevices.Peer("mac-1", "Michael's MacBook", "mac", "", "192.168.1.20:47823", pairing);
    }

    @Test
    public void whatAPeerSaysOfItselfIsKept() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(new KnownDevices.Peer("p", "Pixel", "android", "google", "192.168.1.7", "a1")), 100);
        devices.allGone(200);
        KnownDevices.Device device = devices.list().get(0);
        assertEquals("google", device.maker);
        assertEquals("192.168.1.7", device.address);
        assertEquals("a1", device.pairing);
        assertEquals(100, device.firstSeen);
        assertEquals(200, device.lastSeen);
        // connecting again is not pairing again
        devices.connected(Arrays.asList(new KnownDevices.Peer("p", "Pixel", "android", "", "", "a1")), 300);
        assertEquals(100, devices.list().get(0).firstSeen);
        assertEquals("192.168.1.7", devices.list().get(0).address);
    }

    @Test
    public void aDisconnectedDeviceLeavesTheListAndIsRemembered() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac("a1"), new KnownDevices.Peer("mac-2", "Studio", "mac")), 100);
        assertTrue(devices.remove("mac-1", 200));
        assertFalse("already disconnected", devices.remove("mac-1", 300));
        assertFalse("no such device", devices.remove("nobody", 300));
        assertEquals(1, devices.list().size());
        assertEquals("mac-2", devices.list().get(0).id);
        assertEquals("a1", devices.removedPairing("mac-1"));
        assertTrue(devices.isDisconnected("mac-1"));
        assertFalse(devices.isDisconnected("mac-2"));
        assertEquals(null, devices.removedPairing("mac-2"));
        assertEquals("stored, so it stays disconnected after a restart", 2, devices.all().size());
        // whatever the page reports, it is not connected
        devices.connected(Arrays.asList(mac("a1")), 400);
        assertEquals(1, devices.list().size());
        assertTrue(devices.isDisconnected("mac-1"));
    }

    @Test
    public void aDeviceWithNoPairingIsDisconnectedWithNone() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac()), 100);
        devices.remove("mac-1", 200);
        assertEquals("", devices.removedPairing("mac-1"));
    }

    @Test
    public void aDisconnectedDeviceStaysSoWhenStoredAndRead() {
        KnownDevices first = new KnownDevices(Collections.emptyList());
        first.connected(Arrays.asList(mac("a1")), 100);
        first.remove("mac-1", 200);
        KnownDevices read = new KnownDevices(first.all());
        assertEquals(0, read.list().size());
        assertEquals("a1", read.removedPairing("mac-1"));
    }

    @Test
    public void aDevicePairedAgainIsTakenBack() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac("a1")), 100);
        devices.remove("mac-1", 200);
        assertTrue(devices.restore("mac-1", 300));
        assertFalse("not disconnected any more", devices.restore("mac-1", 400));
        assertEquals(null, devices.removedPairing("mac-1"));
        assertEquals(1, devices.list().size());
        assertEquals(300, devices.list().get(0).firstSeen);
        assertTrue(devices.connected(Arrays.asList(mac("a2")), 500));
        assertTrue(devices.list().get(0).connected);
    }

    @Test
    public void aDeviceThatDisconnectedThisPhoneIsListedAndNotDialed() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        devices.connected(Arrays.asList(mac("a1")), 100);
        assertTrue(devices.removedBy(mac("a1"), 200));
        assertFalse("said again", devices.removedBy(mac("a1"), 300));
        KnownDevices.Device device = devices.list().get(0);
        assertTrue(device.removedUs);
        assertFalse(device.connected);
        assertTrue(devices.isDisconnected("mac-1"));
        assertFalse(devices.anyConnected());
        // it takes a connection again: paired again, there or here
        assertTrue(devices.connected(Arrays.asList(mac("a2")), 400));
        assertFalse(devices.list().get(0).removedUs);
        assertFalse(devices.isDisconnected("mac-1"));
    }

    @Test
    public void aDeviceNeverSeenThatDisconnectedThisPhoneIsListed() {
        KnownDevices devices = new KnownDevices(Collections.emptyList());
        assertTrue(devices.removedBy(mac("a1"), 200));
        assertEquals("Michael's MacBook", devices.list().get(0).name);
        assertTrue(devices.list().get(0).removedUs);
    }

    @Test
    public void theCapNeverForgetsADeviceDisconnectedHere() {
        List<KnownDevices.Device> stored = new ArrayList<>();
        stored.add(new KnownDevices.Device("gone", "Gone", "mac", "", "", "a1", 0, 1, false, "a1", false));
        for (int i = 0; i < KnownDevices.MAX + 5; i++) stored.add(new KnownDevices.Device("d" + i, "D" + i, "mac", 1000 + i, false));
        KnownDevices devices = new KnownDevices(stored);
        assertEquals("a1", devices.removedPairing("gone"));
        assertEquals(KnownDevices.MAX, devices.all().size());
    }
}
