package com.michael.teneo.links;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;

public class PinnedHttpTest {

    private static final long LATER = Long.MAX_VALUE;

    private static PinnedHttp.Response read(String answer, int maxBytes, boolean allowCut) throws Exception {
        InputStream in = new ByteArrayInputStream(answer.getBytes(StandardCharsets.ISO_8859_1));
        return PinnedHttp.read(in, maxBytes, allowCut, LATER);
    }

    private static String text(PinnedHttp.Response response) {
        return new String(response.body, StandardCharsets.UTF_8);
    }

    @Test
    public void connectsToTheCheckedAddressWhateverTheNameSays() throws Exception {
        AtomicReference<String> request = new AtomicReference<>();
        try (ServerSocket server = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) {
            Thread answer = new Thread(() -> {
                try (Socket client = server.accept()) {
                    InputStream in = client.getInputStream();
                    ByteArrayOutputStream head = new ByteArrayOutputStream();
                    while (!head.toString("ISO-8859-1").endsWith("\r\n\r\n")) head.write(in.read());
                    request.set(head.toString("ISO-8859-1"));
                    OutputStream out = client.getOutputStream();
                    out.write("HTTP/1.1 200 OK\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\nhello".getBytes(StandardCharsets.US_ASCII));
                } catch (Exception ignored) {
                    // the test fails on what it reads
                }
            });
            answer.start();
            // a name nothing could look up: only the given address is used
            URL url = new URL("http://rebind.invalid:" + server.getLocalPort() + "/page?q=1");
            PinnedHttp.Response response = PinnedHttp.get(
                PinnedHttp.NETWORK, url, InetAddress.getLoopbackAddress(), "text/html", "Teneo test", 1024, false, LATER, 5000
            );
            answer.join();
            assertEquals(200, response.status);
            assertEquals("text/html", response.contentType);
            assertEquals("hello", text(response));
            assertTrue(request.get(), request.get().startsWith("GET /page?q=1 HTTP/1.1\r\nHost: rebind.invalid:" + server.getLocalPort() + "\r\n"));
            assertTrue(request.get().contains("Accept-Encoding: identity\r\n"));
        }
    }

    @Test
    public void readsBodiesByLengthInChunksOrToTheEnd() throws Exception {
        assertEquals("hello", text(read("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhelloEXTRA", 100, false)));
        assertEquals(
            "hello world",
            text(read("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n5;x=y\r\nhello\r\n6\r\n world\r\n0\r\n\r\n", 100, false))
        );
        assertEquals("to the end", text(read("HTTP/1.0 200 OK\r\n\r\nto the end", 100, false)));
        // an interim answer first
        assertEquals("ok", text(read("HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok", 100, false)));
    }

    @Test
    public void keepsToTheLimit() throws Exception {
        assertNull(read("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789", 5, false).body);
        assertArrayEquals("01234".getBytes(StandardCharsets.US_ASCII), read("HTTP/1.1 200 OK\r\n\r\n0123456789", 5, true).body);
        assertEquals("01234", text(read("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n01234", 5, false)));
    }

    @Test
    public void handsRedirectsBackUnread() throws Exception {
        PinnedHttp.Response response = read("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1/\r\nContent-Length: 3\r\n\r\nabc", 100, false);
        assertEquals(302, response.status);
        assertEquals("http://127.0.0.1/", response.location);
        assertNull(response.body);
    }

    @Test
    public void refusesWhatIsntHttpOrIsTooLong() {
        assertThrows(java.io.IOException.class, () -> read("SSH-2.0-OpenSSH\r\n\r\n", 100, false));
        assertThrows(java.io.IOException.class, () -> read("HTTP/1.1 200 OK\r\nContent-Length: 9\r\n\r\nshort", 100, false));
        assertThrows(java.io.IOException.class, () -> read("HTTP/1.1 200 OK\r\nX: " + "a".repeat(70_000) + "\r\n\r\n", 100, false));
        assertThrows(java.io.IOException.class, () -> read("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n", 100, false));
    }

    @Test
    public void sendsNoHeaderItWasntMeantTo() throws Exception {
        assertThrows(
            IllegalArgumentException.class,
            () -> PinnedHttp.request(new URL("https://example.com/"), "text/html\r\nX-Evil: 1", "Teneo")
        );
        assertThrows(IllegalArgumentException.class, () -> PinnedHttp.request(new URL("https://example.com/a b"), "*/*", "Teneo"));
        assertEquals(
            "GET / HTTP/1.1\r\nHost: example.com\r\nUser-Agent: Teneo\r\nAccept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
            PinnedHttp.request(new URL("https://example.com"), "*/*", "Teneo")
        );
    }
}
