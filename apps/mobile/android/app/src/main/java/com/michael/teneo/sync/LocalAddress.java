package com.michael.teneo.sync;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Sync connections come from this phone or the local network, and from nowhere
 * else. The same rule as the Mac's local-address.ts, test cases included.
 * What is not an address at all is not local: unreadable input is refused.
 */
final class LocalAddress {

    private static final Pattern MAPPED = Pattern.compile("^::ffff:(\\d{1,3}(?:\\.\\d{1,3}){3})$", Pattern.CASE_INSENSITIVE);
    private static final Pattern LINK_LOCAL_V6 = Pattern.compile("^fe[89ab][0-9a-f]:", Pattern.CASE_INSENSITIVE);
    private static final Pattern UNIQUE_LOCAL_V6 = Pattern.compile("^f[cd][0-9a-f]{2}:", Pattern.CASE_INSENSITIVE);
    private static final Pattern V4 = Pattern.compile("^(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})\\.(\\d{1,3})$");

    private LocalAddress() {}

    /** A private, link-local or loopback address, IPv4 or IPv6 */
    static boolean isLocalNetwork(String address) {
        if (address == null) return false;
        Matcher mapped = MAPPED.matcher(address);
        String ip = mapped.matches() ? mapped.group(1) : address;

        if (ip.contains(":")) {
            return ip.equals("::1") || LINK_LOCAL_V6.matcher(ip).find() || UNIQUE_LOCAL_V6.matcher(ip).find();
        }

        Matcher v4 = V4.matcher(ip);
        if (!v4.matches()) return false;
        int first = Integer.parseInt(v4.group(1));
        int second = Integer.parseInt(v4.group(2));
        int third = Integer.parseInt(v4.group(3));
        int fourth = Integer.parseInt(v4.group(4));
        if (first > 255 || second > 255 || third > 255 || fourth > 255) return false;
        return (
            first == 10 ||
            first == 127 ||
            (first == 172 && second >= 16 && second <= 31) ||
            (first == 192 && second == 168) ||
            (first == 169 && second == 254)
        );
    }
}
