package com.michael.teneo.links;

import java.net.Inet6Address;
import java.net.InetAddress;
import java.net.URL;

/**
 * Where a link preview may be fetched from: a web address on the internet,
 * never this phone or the local network. The page checks the address as
 * written (@teneo/shared/links/safety); this checks what its name leads to,
 * such as a router's own domain.
 */
final class LinkFetchRules {

    /** No answer is read past this, whatever the page asks for */
    static final int MAX_BYTES = 4 * 1024 * 1024;

    private LinkFetchRules() {}

    static boolean isWebAddress(URL url) {
        String protocol = url.getProtocol();
        boolean isWeb = protocol.equals("https") || protocol.equals("http");
        return isWeb && url.getHost() != null && !url.getHost().isEmpty() && url.getUserInfo() == null;
    }

    /**
     * This phone, the local network, or an address no public site has. The
     * same ranges as isLocalIp in packages/shared/src/links/safety.ts: an
     * IPv6 address that carries an IPv4 one (NAT64, 6to4) is judged by it.
     */
    static boolean isLocal(InetAddress address) {
        if (
            address.isAnyLocalAddress() ||
            address.isLoopbackAddress() ||
            address.isLinkLocalAddress() ||
            address.isSiteLocalAddress() ||
            address.isMulticastAddress()
        ) {
            return true;
        }
        byte[] bytes = address.getAddress();
        return address instanceof Inet6Address ? isLocalIpv6(bytes) : isLocalIpv4(bytes, 0);
    }

    private static int at(byte[] bytes, int index) {
        return bytes[index] & 0xff;
    }

    static boolean isLocalIpv4(byte[] bytes, int offset) {
        int a = at(bytes, offset);
        int b = at(bytes, offset + 1);
        int c = at(bytes, offset + 2);
        return (
            a == 0 ||
            a == 10 ||
            a == 127 ||
            (a == 100 && b >= 64 && b <= 127) ||
            (a == 169 && b == 254) ||
            (a == 172 && b >= 16 && b <= 31) ||
            (a == 192 && b == 168) ||
            (a == 192 && b == 0 && (c == 0 || c == 2)) ||
            (a == 192 && b == 88 && c == 99) ||
            (a == 198 && (b == 18 || b == 19)) ||
            (a == 198 && b == 51 && c == 100) ||
            (a == 203 && b == 0 && c == 113) ||
            a >= 224
        );
    }

    private static int group(byte[] bytes, int index) {
        return (at(bytes, index * 2) << 8) | at(bytes, index * 2 + 1);
    }

    static boolean isLocalIpv6(byte[] bytes) {
        int h0 = group(bytes, 0);
        int h1 = group(bytes, 1);
        int h2 = group(bytes, 2);
        // NAT64 reaches the IPv4 address it holds; its local-use prefix is the
        // network's own. Both sit inside ::/8, so they come first
        if (h0 == 0x64 && h1 == 0xff9b) {
            if (h2 == 1) return true;
            boolean wellKnown = h2 == 0 && group(bytes, 3) == 0 && group(bytes, 4) == 0 && group(bytes, 5) == 0;
            return !wellKnown || isLocalIpv4(bytes, 12);
        }
        if (h0 >> 8 == 0) return true; // ::/8: unspecified, loopback, IPv4 as IPv6
        if (h0 == 0x100 && h1 == 0 && h2 == 0 && group(bytes, 3) == 0) return true; // discard
        if (h0 == 0x2001 && h1 < 0x200) return true; // IETF: Teredo, benchmarking
        if (h0 == 0x2001 && h1 == 0xdb8) return true; // documentation
        if (h0 == 0x2002) return isLocalIpv4(bytes, 2); // 6to4
        if (h0 == 0x3fff && h1 >> 12 == 0) return true; // documentation
        if (h0 == 0x5f00) return true; // segment routing
        return (h0 & 0xfe00) == 0xfc00 || (h0 & 0xff80) == 0xfe80 || (h0 & 0xff00) == 0xff00;
    }

    /** How much of an answer to read: what the page asked for, within reason */
    static int byteLimit(Integer asked) {
        if (asked == null || asked <= 0) return 0;
        return Math.min(asked, MAX_BYTES);
    }

    static boolean isSuccess(int status) {
        return status >= 200 && status < 300;
    }
}
