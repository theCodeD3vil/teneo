package com.michael.teneo.sync;

import java.util.ArrayList;
import java.util.Collection;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The devices this phone has synced with since it was paired: what each is
 * called and when it was last seen. Sync's store doesn't list them (yet), so
 * they are kept here, from what the sync page says is connected.
 */
final class KnownDevices {

    /** Past this many, the one seen longest ago is forgotten */
    static final int MAX = 32;

    /** A device as the sync page reports it, while it is connected */
    static final class Peer {

        final String id;
        final String name;
        final String platform;

        Peer(String id, String name, String platform) {
            this.id = id;
            this.name = name;
            this.platform = platform;
        }
    }

    static final class Device {

        final String id;
        final String name;
        final String platform;
        /** When it was last connected; while connected, when it connected or was last reported */
        final long lastSeen;
        final boolean connected;

        Device(String id, String name, String platform, long lastSeen, boolean connected) {
            this.id = id;
            this.name = name;
            this.platform = platform;
            this.lastSeen = lastSeen;
            this.connected = connected;
        }
    }

    private final Map<String, Device> devices = new LinkedHashMap<>();

    /** Devices as they were stored: none of them is connected now */
    KnownDevices(Collection<Device> stored) {
        for (Device device : stored) {
            if (device.id == null || device.id.isEmpty()) continue;
            devices.put(device.id, new Device(device.id, device.name, device.platform, device.lastSeen, false));
        }
        trim();
    }

    /** These are the connected devices now. Whether anything changed. */
    boolean connected(List<Peer> peers, long now) {
        boolean changed = false;
        Set<String> present = new HashSet<>();
        for (Peer peer : peers) {
            if (peer.id == null || peer.id.isEmpty()) continue;
            present.add(peer.id);
            Device known = devices.get(peer.id);
            String name = peer.name == null || peer.name.isEmpty() ? (known == null ? "" : known.name) : peer.name;
            String platform = peer.platform == null || peer.platform.isEmpty() ? (known == null ? "" : known.platform) : peer.platform;
            if (known != null && known.connected && known.name.equals(name) && known.platform.equals(platform)) continue;
            devices.put(peer.id, new Device(peer.id, name, platform, now, true));
            changed = true;
        }
        for (Device device : new ArrayList<>(devices.values())) {
            if (device.connected && !present.contains(device.id)) {
                devices.put(device.id, new Device(device.id, device.name, device.platform, now, false));
                changed = true;
            }
        }
        trim();
        return changed;
    }

    /** Sync stopped: every connection ended now */
    boolean allGone(long now) {
        return connected(new ArrayList<>(), now);
    }

    void clear() {
        devices.clear();
    }

    /** Connected ones first, then the most recently seen */
    List<Device> list() {
        List<Device> sorted = new ArrayList<>(devices.values());
        sorted.sort((a, b) -> {
            if (a.connected != b.connected) return a.connected ? -1 : 1;
            return Long.compare(b.lastSeen, a.lastSeen);
        });
        return sorted;
    }

    boolean anyConnected() {
        for (Device device : devices.values()) if (device.connected) return true;
        return false;
    }

    private void trim() {
        while (devices.size() > MAX) {
            Device oldest = null;
            for (Device device : devices.values()) {
                if (device.connected) continue;
                if (oldest == null || device.lastSeen < oldest.lastSeen) oldest = device;
            }
            if (oldest == null) return;
            devices.remove(oldest.id);
        }
    }
}
