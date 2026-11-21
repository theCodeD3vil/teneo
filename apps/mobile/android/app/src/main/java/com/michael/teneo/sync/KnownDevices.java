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
 * called, where and when it was last seen, and whether the user ended sync
 * with it. Sync's store doesn't list them (yet), so they are kept here, from
 * what the sync page says is connected.
 *
 * A device disconnected here is refused by the sync core until it is paired
 * again, which it shows by a new pairing id (`removals` in the core's
 * engine.ts). One that disconnected this phone says so, and is not dialed
 * until it takes a connection again.
 */
final class KnownDevices {

    /** Past this many, the one seen longest ago is forgotten */
    static final int MAX = 32;

    /** A device as the sync page reports it, while it is connected */
    static final class Peer {

        final String id;
        final String name;
        final String platform;
        /** Who made it, as it said ("google"); empty when it didn't */
        final String maker;
        /** Where it is on the network; empty when the page didn't say */
        final String address;
        /** The id of its pairing; empty when it said none */
        final String pairing;

        Peer(String id, String name, String platform) {
            this(id, name, platform, "", "", "");
        }

        Peer(String id, String name, String platform, String maker, String address, String pairing) {
            this.id = id;
            this.name = name;
            this.platform = platform;
            this.maker = maker == null ? "" : maker;
            this.address = address == null ? "" : address;
            this.pairing = pairing == null ? "" : pairing;
        }
    }

    static final class Device {

        final String id;
        final String name;
        final String platform;
        final String maker;
        final String address;
        final String pairing;
        /** When it first connected, or was taken back; 0 for one from before this was kept */
        final long firstSeen;
        /** When it was last connected; while connected, when it connected or was last reported */
        final long lastSeen;
        final boolean connected;
        /** The pairing it had when it was disconnected here; null while it isn't */
        final String removedPairing;
        /** It said it disconnected this phone */
        final boolean removedUs;

        Device(String id, String name, String platform, long lastSeen, boolean connected) {
            this(id, name, platform, "", "", "", 0, lastSeen, connected, null, false);
        }

        Device(
            String id,
            String name,
            String platform,
            String maker,
            String address,
            String pairing,
            long firstSeen,
            long lastSeen,
            boolean connected,
            String removedPairing,
            boolean removedUs
        ) {
            this.id = id;
            this.name = name == null ? "" : name;
            this.platform = platform == null ? "" : platform;
            this.maker = maker == null ? "" : maker;
            this.address = address == null ? "" : address;
            this.pairing = pairing == null ? "" : pairing;
            this.firstSeen = firstSeen;
            this.lastSeen = lastSeen;
            this.connected = connected;
            this.removedPairing = removedPairing;
            this.removedUs = removedUs;
        }

        /** Sync between it and this phone was ended, by either of the two */
        boolean disconnected() {
            return removedPairing != null || removedUs;
        }

        private Device gone(long now) {
            return new Device(id, name, platform, maker, address, pairing, firstSeen, now, false, removedPairing, removedUs);
        }
    }

    private final Map<String, Device> devices = new LinkedHashMap<>();

    /** Devices as they were stored: none of them is connected now */
    KnownDevices(Collection<Device> stored) {
        for (Device device : stored) {
            if (device.id == null || device.id.isEmpty()) continue;
            devices.put(
                device.id,
                new Device(
                    device.id,
                    device.name,
                    device.platform,
                    device.maker,
                    device.address,
                    device.pairing,
                    device.firstSeen,
                    device.lastSeen,
                    false,
                    device.removedPairing,
                    device.removedUs
                )
            );
        }
        trim();
    }

    /** These are the connected devices now. Whether anything changed. */
    boolean connected(List<Peer> peers, long now) {
        boolean changed = false;
        Set<String> present = new HashSet<>();
        for (Peer peer : peers) {
            if (peer.id == null || peer.id.isEmpty()) continue;
            Device known = devices.get(peer.id);
            // one disconnected here is not connected, whatever is reported
            if (known != null && known.removedPairing != null) continue;
            present.add(peer.id);
            String name = orKnown(peer.name, known == null ? "" : known.name);
            String platform = orKnown(peer.platform, known == null ? "" : known.platform);
            String maker = orKnown(peer.maker, known == null ? "" : known.maker);
            String address = orKnown(peer.address, known == null ? "" : known.address);
            if (
                known != null &&
                known.connected &&
                known.name.equals(name) &&
                known.platform.equals(platform) &&
                known.maker.equals(maker) &&
                known.address.equals(address) &&
                known.pairing.equals(peer.pairing)
            ) continue;
            // it took this phone's connection: it no longer keeps this phone away
            devices.put(
                peer.id,
                new Device(peer.id, name, platform, maker, address, peer.pairing, known == null ? now : known.firstSeen, now, true, null, false)
            );
            changed = true;
        }
        for (Device device : new ArrayList<>(devices.values())) {
            if (device.connected && !present.contains(device.id)) {
                devices.put(device.id, device.gone(now));
                changed = true;
            }
        }
        trim();
        return changed;
    }

    private static String orKnown(String said, String known) {
        return said == null || said.isEmpty() ? known : said;
    }

    /** Sync stopped: every connection ended now */
    boolean allGone(long now) {
        return connected(new ArrayList<>(), now);
    }

    /** The user disconnected this device. False when there is no such device, or it already is. */
    boolean remove(String id, long now) {
        Device known = devices.get(id);
        if (known == null || known.removedPairing != null) return false;
        devices.put(
            id,
            new Device(
                id,
                known.name,
                known.platform,
                known.maker,
                known.address,
                known.pairing,
                known.firstSeen,
                known.connected ? now : known.lastSeen,
                false,
                known.pairing,
                false
            )
        );
        return true;
    }

    /** The pairing a device had when it was disconnected here; null when it isn't */
    String removedPairing(String id) {
        Device known = devices.get(id);
        return known == null ? null : known.removedPairing;
    }

    /** A device disconnected here was paired again: it is one of the devices once more */
    boolean restore(String id, long now) {
        Device known = devices.get(id);
        if (known == null || known.removedPairing == null) return false;
        devices.put(
            id,
            new Device(id, known.name, known.platform, known.maker, known.address, known.pairing, now, known.lastSeen, false, null, false)
        );
        return true;
    }

    /** A device said it disconnected this phone */
    boolean removedBy(Peer peer, long now) {
        if (peer.id == null || peer.id.isEmpty()) return false;
        Device known = devices.get(peer.id);
        if (known != null && known.removedUs && !known.connected) return false;
        devices.put(
            peer.id,
            new Device(
                peer.id,
                orKnown(peer.name, known == null ? "" : known.name),
                orKnown(peer.platform, known == null ? "" : known.platform),
                orKnown(peer.maker, known == null ? "" : known.maker),
                orKnown(peer.address, known == null ? "" : known.address),
                orKnown(peer.pairing, known == null ? "" : known.pairing),
                known == null ? now : known.firstSeen,
                now,
                false,
                known == null ? null : known.removedPairing,
                true
            )
        );
        trim();
        return true;
    }

    /** Whether sync with this device was ended, by either side: it is not dialed */
    boolean isDisconnected(String id) {
        Device known = devices.get(id);
        return known != null && known.disconnected();
    }

    void clear() {
        devices.clear();
    }

    /** The devices to show: connected ones first, then the most recently seen. Not the ones disconnected here. */
    List<Device> list() {
        List<Device> sorted = new ArrayList<>();
        for (Device device : devices.values()) if (device.removedPairing == null) sorted.add(device);
        sorted.sort((a, b) -> {
            if (a.connected != b.connected) return a.connected ? -1 : 1;
            return Long.compare(b.lastSeen, a.lastSeen);
        });
        return sorted;
    }

    /** Every device kept, the ones disconnected here too: what is stored */
    List<Device> all() {
        return new ArrayList<>(devices.values());
    }

    boolean anyConnected() {
        for (Device device : devices.values()) if (device.connected) return true;
        return false;
    }

    private void trim() {
        while (devices.size() > MAX) {
            Device oldest = null;
            for (Device device : devices.values()) {
                // forgetting one disconnected here would let it back in
                if (device.connected || device.removedPairing != null) continue;
                if (oldest == null || device.lastSeen < oldest.lastSeen) oldest = device;
            }
            if (oldest == null) return;
            devices.remove(oldest.id);
        }
    }
}
