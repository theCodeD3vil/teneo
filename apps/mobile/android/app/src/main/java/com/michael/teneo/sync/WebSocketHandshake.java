package com.michael.teneo.sync;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * The HTTP side of a WebSocket (RFC 6455, section 4): a server judging an
 * upgrade request and answering it, and a client making one and checking the
 * answer. The head of a message is read under a size limit and a deadline, so
 * a peer that trickles bytes can't hold a thread.
 */
final class WebSocketHandshake {

    private static final String GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    private static final SecureRandom RANDOM = new SecureRandom();

    private WebSocketHandshake() {}

    /** The request line and headers of a message. Names are lower case. */
    static final class Head {

        final String firstLine;
        final Map<String, String> headers;

        Head(String firstLine, Map<String, String> headers) {
            this.firstLine = firstLine;
            this.headers = headers;
        }
    }

    /** What a server makes of a request */
    enum Verdict {
        /** a valid upgrade to answer with 101 */
        UPGRADE,
        /** an ordinary web request: told to upgrade (426) */
        NOT_AN_UPGRADE,
        /** an upgrade that is wrong in a way a proper client would not be (400) */
        BAD
    }

    /** Sec-WebSocket-Accept for a Sec-WebSocket-Key */
    static String acceptKey(String key) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-1").digest((key + GUID).getBytes(StandardCharsets.US_ASCII));
            return Base64.getEncoder().encodeToString(hash);
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException(error); // every Java has SHA-1
        }
    }

    static String newKey() {
        byte[] nonce = new byte[16];
        RANDOM.nextBytes(nonce);
        return Base64.getEncoder().encodeToString(nonce);
    }

    /**
     * Reads up to the blank line that ends an HTTP head, no further: what
     * follows belongs to the frames. Fails with a ProtocolViolation when the
     * head is too long or not HTTP, and with a SocketTimeoutException when it
     * isn't complete by `deadlineMs` (a System.currentTimeMillis time).
     */
    static Head readHead(Socket socket, InputStream in, int maxBytes, long deadlineMs) throws IOException {
        ByteArrayOutputStream head = new ByteArrayOutputStream();
        int matched = 0; // how much of \r\n\r\n the last bytes are
        while (matched < 4) {
            // only a read that has to wait for the network can run past the
            // deadline: bytes already here cost no time, and no system call
            if (in.available() == 0) {
                long remaining = deadlineMs - System.currentTimeMillis();
                if (remaining <= 0) throw new SocketTimeoutException("the request head took too long");
                socket.setSoTimeout((int) Math.min(remaining, Integer.MAX_VALUE));
            }
            int value = in.read();
            if (value < 0) throw new java.io.EOFException();
            head.write(value);
            if (head.size() > maxBytes) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "request head too long");
            boolean expected = (matched % 2 == 0) ? value == '\r' : value == '\n';
            matched = expected ? matched + 1 : (value == '\r' ? 1 : 0);
        }
        return parseHead(new String(head.toByteArray(), StandardCharsets.ISO_8859_1));
    }

    static Head parseHead(String text) throws ProtocolViolation {
        String[] lines = text.split("\r\n", -1);
        if (lines.length < 3 || lines[0].isEmpty()) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "not an HTTP message");
        Map<String, String> headers = new HashMap<>();
        for (int i = 1; i < lines.length - 2; i++) {
            String line = lines[i];
            int colon = line.indexOf(':');
            if (colon <= 0 || line.charAt(0) == ' ' || line.charAt(0) == '\t') {
                throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "bad header line");
            }
            String name = line.substring(0, colon).trim().toLowerCase(Locale.ROOT);
            String value = line.substring(colon + 1).trim();
            // a header sent twice is one list, as HTTP says
            headers.merge(name, value, (before, now) -> before + ", " + now);
        }
        return new Head(lines[0], headers);
    }

    // --- server

    static Verdict judge(Head request) {
        String[] parts = request.firstLine.split(" ");
        // "METHOD target HTTP/x.y": anything else is not a web request at all
        if (parts.length != 3 || !parts[2].startsWith("HTTP/")) return Verdict.BAD;
        boolean isGet = parts.length == 3 && parts[0].equals("GET") && parts[2].equals("HTTP/1.1");
        String upgrade = request.headers.getOrDefault("upgrade", "").toLowerCase(Locale.ROOT);
        boolean asksToUpgrade = hasToken(request.headers.get("connection"), "upgrade") && upgrade.equals("websocket");
        if (!isGet || !asksToUpgrade) return Verdict.NOT_AN_UPGRADE;
        if (!"13".equals(request.headers.get("sec-websocket-version"))) return Verdict.BAD;
        String key = request.headers.get("sec-websocket-key");
        try {
            if (key == null || Base64.getDecoder().decode(key).length != 16) return Verdict.BAD;
        } catch (IllegalArgumentException error) {
            return Verdict.BAD;
        }
        return Verdict.UPGRADE;
    }

    static byte[] upgradeResponse(String key) {
        return (
            "HTTP/1.1 101 Switching Protocols\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Accept: " + acceptKey(key) + "\r\n\r\n"
        ).getBytes(StandardCharsets.US_ASCII);
    }

    /** A plain answer that ends the connection: 403, 426, 429, 503... */
    static byte[] statusResponse(int status, String reason, String body, String extraHeaders) {
        byte[] text = body.getBytes(StandardCharsets.UTF_8);
        String head =
            "HTTP/1.1 " + status + " " + reason + "\r\n" +
            "Content-Type: text/plain; charset=utf-8\r\n" +
            "Content-Length: " + text.length + "\r\n" +
            "Connection: close\r\n" +
            extraHeaders +
            "\r\n";
        byte[] headBytes = head.getBytes(StandardCharsets.US_ASCII);
        byte[] response = new byte[headBytes.length + text.length];
        System.arraycopy(headBytes, 0, response, 0, headBytes.length);
        System.arraycopy(text, 0, response, headBytes.length, text.length);
        return response;
    }

    // --- client

    static byte[] clientRequest(String host, String key) {
        return (
            "GET / HTTP/1.1\r\n" +
            "Host: " + host + "\r\n" +
            "Upgrade: websocket\r\n" +
            "Connection: Upgrade\r\n" +
            "Sec-WebSocket-Key: " + key + "\r\n" +
            "Sec-WebSocket-Version: 13\r\n\r\n"
        ).getBytes(StandardCharsets.US_ASCII);
    }

    /** Fails unless the server accepted the upgrade for this key */
    static void checkResponse(Head response, String key) throws IOException {
        if (!response.firstLine.startsWith("HTTP/1.1 101")) {
            throw new IOException("the other device did not upgrade: " + response.firstLine);
        }
        boolean isWebSocket = "websocket".equalsIgnoreCase(response.headers.get("upgrade"));
        boolean accepted = acceptKey(key).equals(response.headers.get("sec-websocket-accept"));
        if (!isWebSocket || !hasToken(response.headers.get("connection"), "upgrade") || !accepted) {
            throw new IOException("the other device's upgrade was wrong");
        }
    }

    private static boolean hasToken(String list, String token) {
        if (list == null) return false;
        for (String item : list.split(",")) if (item.trim().equalsIgnoreCase(token)) return true;
        return false;
    }
}
