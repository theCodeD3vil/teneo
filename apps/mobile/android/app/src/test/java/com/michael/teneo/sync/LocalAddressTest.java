package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/** The same cases as the Mac's local-address.test.ts: both must judge alike */
public class LocalAddressTest {

    private static void check(boolean expected, String... addresses) {
        for (String address : addresses) {
            assertEquals(address, expected, LocalAddress.isLocalNetwork(address));
        }
    }

    @Test
    public void privateLinkLocalAndLoopbackAreAllowed() {
        check(
            true,
            "127.0.0.1", "127.1.2.3", "10.0.0.5", "10.255.255.255", "172.16.0.1", "172.31.255.254",
            "192.168.43.1", "169.254.10.20", "::1", "fe80::1ff:fe23:4567:890a", "fd12:3456:789a::1", "fc00::1"
        );
    }

    @Test
    public void publicAddressesAreNot() {
        check(
            false,
            "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1",
            "100.64.0.1", // carrier-grade NAT is not the local network
            "169.255.0.1", "2001:4860:4860::8888", "fec0::1"
        );
    }

    @Test
    public void anIpv4AddressWrittenAsIpv6IsJudgedAsTheIpv4Address() {
        check(true, "::ffff:192.168.1.7");
        check(false, "::ffff:8.8.8.8");
    }

    @Test
    public void whatIsNotAnAddressIsRefusedNotWavedThrough() {
        check(false, "", "localhost", "example.com", "10.0.0", "10.0.0.256", "10.0.0.1.5", "::", "undefined", "10.0.0.1 ");
        assertEquals(false, LocalAddress.isLocalNetwork(null));
    }
}
