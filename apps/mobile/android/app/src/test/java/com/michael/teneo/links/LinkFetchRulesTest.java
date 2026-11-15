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
