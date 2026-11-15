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

    /** This phone, the local network, or an address no public site has */
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
        if (address instanceof Inet6Address) {
            // unique local, fc00::/7
            return (bytes[0] & 0xfe) == 0xfc;
        }
        int first = bytes[0] & 0xff;
        int second = bytes[1] & 0xff;
        // "this network", and the range carriers share between customers
        return first == 0 || (first == 100 && second >= 64 && second <= 127);
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
