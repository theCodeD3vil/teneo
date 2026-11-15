package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class WebSocketHandshakeTest {

    private static final String KEY = "dGhlIHNhbXBsZSBub25jZQ==";

    private static WebSocketHandshake.Head head(String text) throws IOException {
        return WebSocketHandshake.parseHead(text.replace("\n", "\r\n") + "\r\n\r\n");
    }

    @Test
    public void theAcceptKeyIsTheOneInTheRfc() {
        // RFC 6455, section 1.3
        assertEquals("s3pPLMBiTxaQ9kYGzzhZRbK+xOo=", WebSocketHandshake.acceptKey(KEY));
    }

    @Test
    public void aProperUpgradeIsAccepted() throws IOException {
        WebSocketHandshake.Head request = head(
            "GET / HTTP/1.1\nHost: 192.168.1.2:47823\nUpgrade: websocket\nConnection: keep-alive, Upgrade\n" +
            "Sec-WebSocket-Key: " + KEY + "\nSec-WebSocket-Version: 13"
        );
        assertEquals(WebSocketHandshake.Verdict.UPGRADE, WebSocketHandshake.judge(request));
    }

    @Test
    public void anOrdinaryRequestIsToldToUpgrade() throws IOException {
        assertEquals(WebSocketHandshake.Verdict.NOT_AN_UPGRADE, WebSocketHandshake.judge(head("GET / HTTP/1.1\nHost: x")));
        assertEquals(WebSocketHandshake.Verdict.NOT_AN_UPGRADE, WebSocketHandshake.judge(head("POST / HTTP/1.1\nUpgrade: websocket\nConnection: Upgrade")));
    }

    @Test
    public void anUpgradeWithABadVersionOrKeyIsRefused() throws IOException {
        String upgrade = "GET / HTTP/1.1\nUpgrade: websocket\nConnection: Upgrade\n";
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head(upgrade + "Sec-WebSocket-Key: " + KEY + "\nSec-WebSocket-Version: 8")));
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head(upgrade + "Sec-WebSocket-Version: 13")));
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head(upgrade + "Sec-WebSocket-Key: short\nSec-WebSocket-Version: 13")));
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head(upgrade + "Sec-WebSocket-Key: not base64!!\nSec-WebSocket-Version: 13")));
    }

    @Test
    public void headerNamesAreCaseInsensitiveAndRepeatedOnesJoin() throws IOException {
        WebSocketHandshake.Head request = head("GET / HTTP/1.1\nUPGRADE: WebSocket\nConnection: keep-alive\nconnection: Upgrade");
        assertEquals("keep-alive, Upgrade", request.headers.get("connection"));
        assertEquals("WebSocket", request.headers.get("upgrade"));
    }

    @Test
    public void notHttpIsRefused() throws IOException {
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head("hello")));
        assertEquals(WebSocketHandshake.Verdict.BAD, WebSocketHandshake.judge(head("GET /")));
        assertThrows(ProtocolViolation.class, () -> WebSocketHandshake.parseHead("GET / HTTP/1.1\r\nno colon here\r\n\r\n"));
        assertThrows(ProtocolViolation.class, () -> WebSocketHandshake.parseHead("GET / HTTP/1.1\r\n folded: header\r\n\r\n"));
    }

    @Test
    public void theServersAnswerIsCheckedAgainstTheKey() throws IOException {
        String good = "HTTP/1.1 101 Switching Protocols\nUpgrade: websocket\nConnection: Upgrade\nSec-WebSocket-Accept: s3pPLMBiTxaQ9kYGzzhZRbK+xOo=";
        WebSocketHandshake.checkResponse(head(good), KEY);
        assertThrows(IOException.class, () -> WebSocketHandshake.checkResponse(head(good.replace("s3pP", "xxxx")), KEY));
        assertThrows(IOException.class, () -> WebSocketHandshake.checkResponse(head("HTTP/1.1 426 Upgrade Required\nContent-Length: 0"), KEY));
        assertThrows(IOException.class, () -> WebSocketHandshake.checkResponse(head(good.replace("Upgrade: websocket\n", "")), KEY));
    }

    @Test
    public void whatServerAnswersTheClientAccepts() throws IOException {
        String key = WebSocketHandshake.newKey();
        String response = new String(WebSocketHandshake.upgradeResponse(key), StandardCharsets.US_ASCII);
        WebSocketHandshake.checkResponse(WebSocketHandshake.parseHead(response), key);
    }

    @Test
    public void theHeadIsReadUpToTheBlankLineAndNoFurther() throws IOException {
        byte[] bytes = "GET / HTTP/1.1\r\nHost: x\r\n\r\nFRAME".getBytes(StandardCharsets.US_ASCII);
        ByteArrayInputStream in = new ByteArrayInputStream(bytes);
        try (ServerSocket server = new ServerSocket(0); Socket socket = new Socket("127.0.0.1", server.getLocalPort())) {
            WebSocketHandshake.Head head = WebSocketHandshake.readHead(socket, in, 1024, System.currentTimeMillis() + 5000);
            assertEquals("GET / HTTP/1.1", head.firstLine);
            assertEquals("FRAME", new String(in.readAllBytes(), StandardCharsets.US_ASCII));
        }
    }

    @Test
    public void aHeadThatIsTooLongOrTooSlowIsRefused() throws IOException {
        byte[] long_ = ("GET / HTTP/1.1\r\nX: " + "a".repeat(5000) + "\r\n\r\n").getBytes(StandardCharsets.US_ASCII);
        try (ServerSocket server = new ServerSocket(0); Socket socket = new Socket("127.0.0.1", server.getLocalPort())) {
            assertThrows(ProtocolViolation.class, () -> WebSocketHandshake.readHead(socket, new ByteArrayInputStream(long_), 4096, System.currentTimeMillis() + 5000));
            // no bytes ever come: the socket's own read times out at the deadline
            Socket silent = new Socket("127.0.0.1", server.getLocalPort());
            long start = System.currentTimeMillis();
            assertThrows(SocketTimeoutException.class, () -> WebSocketHandshake.readHead(silent, silent.getInputStream(), 4096, start + 300));
            assertTrue(System.currentTimeMillis() - start < 3000);
            silent.close();
        }
    }
}
