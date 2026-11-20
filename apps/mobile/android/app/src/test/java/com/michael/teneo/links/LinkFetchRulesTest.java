package com.michael.teneo.links;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.net.InetAddress;
import java.net.URL;
import org.junit.Test;

public class LinkFetchRulesTest {

    private static boolean isLocal(String ip) throws Exception {
        // a literal address: nothing is looked up
        return LinkFetchRules.isLocal(InetAddress.getByName(ip));
    }

    @Test
    public void thisPhoneAndTheLocalNetworkAreNeverAsked() throws Exception {
        for (String ip : new String[] {
            "127.0.0.1", "10.0.0.5", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254",
            "100.64.0.1", "100.127.255.255", "0.0.0.0", "0.1.2.3", "224.0.0.251",
            "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:192.168.1.1", "::ffff:127.0.0.1",
        }) {
            assertTrue(ip, isLocal(ip));
        }
    }

    @Test
    public void ipv6RangesThatReachHomeOrNowhereAreNeverAsked() throws Exception {
        for (String ip : new String[] {
            "64:ff9b::7f00:1", "64:ff9b::c0a8:101", "64:ff9b::a9fe:a9fe", "64:ff9b:1::1", "2002:7f00:1::1", "2002:c0a8:101::1",
            "100::1", "2001:db8::1", "2001:2::1", "2001::1", "ff02::1", "fec0::1", "::7f00:1", "0:0:0:0:0:0:0:1",
            "192.0.2.1", "198.18.0.1", "203.0.113.5", "240.0.0.1", "255.255.255.255",
        }) {
            assertTrue(ip, isLocal(ip));
        }
        // NAT64 and 6to4 with a public address inside: an IPv6-only network
        assertFalse(isLocal("64:ff9b::5db8:d822"));
        assertFalse(isLocal("2002:5db8:d822::1"));
    }

    @Test
    public void publicAddressesAreAsked() throws Exception {
        for (String ip : new String[] {
            "8.8.8.8", "93.184.216.34", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.167.1.1",
            "2606:4700:4700::1111", "::ffff:8.8.8.8",
        }) {
            assertFalse(ip, isLocal(ip));
        }
    }

    @Test
    public void onlyWebAddressesWithoutASignInAreAsked() throws Exception {
        assertTrue(LinkFetchRules.isWebAddress(new URL("https://example.com/a?b=c")));
        assertTrue(LinkFetchRules.isWebAddress(new URL("http://example.com:8080/")));
        assertFalse(LinkFetchRules.isWebAddress(new URL("ftp://example.com/")));
        assertFalse(LinkFetchRules.isWebAddress(new URL("file:///etc/hosts")));
        assertFalse(LinkFetchRules.isWebAddress(new URL("https://user:secret@example.com/")));
    }

    @Test
    public void anAnswerIsReadOnlySoFar() {
        assertEquals(0, LinkFetchRules.byteLimit(null));
        assertEquals(0, LinkFetchRules.byteLimit(-1));
        assertEquals(1024, LinkFetchRules.byteLimit(1024));
        assertEquals(LinkFetchRules.MAX_BYTES, LinkFetchRules.byteLimit(Integer.MAX_VALUE));
    }
}
