package com.michael.teneo.sync;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Enumeration;
import java.util.List;

/**
 * The IPv4 addresses this phone has on local networks, as one string: when it
 * changes, so has the network (Wi-Fi joined or left, the hotspot turned on or
 * off). The Mac's networkSignature() in lan-transport.ts does the same.
 * Polling this finds a hotspot too, which is not a network the system tells
 * apps about.
 */
final class NetworkSignature {

    private NetworkSignature() {}

    static String current() {
        List<String> found = new ArrayList<>();
        try {
            Enumeration<NetworkInterface> faces = NetworkInterface.getNetworkInterfaces();
            if (faces == null) return "";
            for (NetworkInterface face : Collections.list(faces)) {
                if (!face.isUp() || face.isLoopback()) continue;
                for (InetAddress address : Collections.list(face.getInetAddresses())) {
                    if (!(address instanceof Inet4Address)) continue;
                    String text = address.getHostAddress();
                    if (LocalAddress.isLocalNetwork(text)) found.add(face.getName() + ":" + text);
                }
            }
        } catch (SocketException error) {
            return "";
        }
        Collections.sort(found);
        return String.join(",", found);
    }
}
