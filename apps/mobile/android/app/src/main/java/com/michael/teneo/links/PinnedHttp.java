package com.michael.teneo.links;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

/**
 * One HTTP/1.1 GET over a connection to an address already checked. Android's
 * HttpURLConnection would look the name up again, and a name can answer a
 * public address the first time and 127.0.0.1 or a router the second (DNS
 * rebinding). Here the socket goes to the checked address, while TLS still
 * names the site (SNI) and checks its certificate against that name.
 */
final class PinnedHttp {

    /** A server's headers longer than this are not believed */
    private static final int MAX_HEADER_BYTES = 64 * 1024;

    static final class Response {

        int status;
        String location;
        String contentType;
        /** null when the body wasn't read: not a success, or longer than allowed */
        byte[] body;
    }

    interface SocketMaker {
        Socket connect(InetAddress address, int port, String host, boolean tls, int timeoutMs) throws IOException;
    }

    /** The real thing: a TCP connection, wrapped in TLS for https */
    static final SocketMaker NETWORK = (address, port, host, tls, timeoutMs) -> {
        Socket socket = new Socket();
        try {
            socket.connect(new InetSocketAddress(address, port), timeoutMs);
            socket.setSoTimeout(timeoutMs);
            if (!tls) return socket;
            // the host name, not the address: TLS sends it as SNI
            SSLSocket secure = (SSLSocket) ((SSLSocketFactory) SSLSocketFactory.getDefault()).createSocket(socket, host, port, true);
            secure.setSoTimeout(timeoutMs);
            secure.startHandshake();
            if (!HttpsURLConnection.getDefaultHostnameVerifier().verify(host, secure.getSession())) {
                secure.close();
                throw new IOException("The certificate isn't " + host + "'s");
            }
            return secure;
        } catch (IOException | RuntimeException error) {
            socket.close();
            throw error;
        }
    };

    private PinnedHttp() {}

    /** A header value or path as sent: one line, plain ASCII */
    static boolean isPlainLine(String text) {
        if (text == null) return false;
        for (int i = 0; i < text.length(); i++) {
            char c = text.charAt(i);
            if (c < 0x20 || c >= 0x7f) return false;
        }
        return true;
    }

    /** The request line and headers of a GET for `url` */
    static String request(URL url, String accept, String userAgent) {
        String path = url.getFile().isEmpty() ? "/" : url.getFile();
        if (!isPlainLine(path) || path.contains(" ") || !isPlainLine(accept) || !isPlainLine(userAgent)) {
            throw new IllegalArgumentException("Not a request Teneo sends");
        }
        int port = url.getPort();
        String host = url.getHost() + (port == -1 || port == url.getDefaultPort() ? "" : ":" + port);
        return (
            "GET " + path + " HTTP/1.1\r\n" +
            "Host: " + host + "\r\n" +
            "User-Agent: " + userAgent + "\r\n" +
            "Accept: " + accept + "\r\n" +
            // the bytes as the site has them: no decompressing here
            "Accept-Encoding: identity\r\n" +
            "Connection: close\r\n\r\n"
        );
    }

    static Response get(
        SocketMaker sockets,
        URL url,
        InetAddress address,
        String accept,
        String userAgent,
        int maxBytes,
        boolean allowCut,
        long deadline,
        int timeoutMs
    ) throws IOException {
        boolean tls = "https".equals(url.getProtocol());
        int port = url.getPort() == -1 ? url.getDefaultPort() : url.getPort();
        String host = url.getHost().replaceAll("^\\[|\\]$", "");
        byte[] head = request(url, accept, userAgent).getBytes(StandardCharsets.US_ASCII);
        try (Socket socket = sockets.connect(address, port, host, tls, timeoutMs)) {
            OutputStream out = socket.getOutputStream();
            out.write(head);
            out.flush();
            InputStream in = new BufferedInputStream(socket.getInputStream());
            return read(in, maxBytes, allowCut, deadline);
        }
    }

    /** The response on `in`: its status line and headers, then a success's body */
    static Response read(InputStream in, int maxBytes, boolean allowCut, long deadline) throws IOException {
        Response response = new Response();
        int[] headerBytes = { 0 };
        boolean chunked;
        long length;
        do {
            String statusLine = line(in, headerBytes);
            String[] parts = statusLine.split(" ", 3);
            if (parts.length < 2 || !parts[0].startsWith("HTTP/1.") || !parts[1].matches("\\d{3}")) {
                throw new IOException("Not an HTTP answer");
            }
            response.status = Integer.parseInt(parts[1]);
            chunked = false;
            length = -1;
            for (String field = line(in, headerBytes); !field.isEmpty(); field = line(in, headerBytes)) {
                int colon = field.indexOf(':');
                if (colon <= 0) continue;
                String name = field.substring(0, colon).trim().toLowerCase(Locale.ROOT);
                String value = field.substring(colon + 1).trim();
                if (name.equals("location")) response.location = value;
                else if (name.equals("content-type")) response.contentType = value;
                else if (name.equals("transfer-encoding")) chunked = value.toLowerCase(Locale.ROOT).contains("chunked");
                else if (name.equals("content-length")) {
                    try {
                        length = Long.parseLong(value);
                    } catch (NumberFormatException garbled) {
                        throw new IOException("A garbled length");
                    }
                }
            }
            // an interim answer, such as 100 Continue, comes before the real one
        } while (response.status >= 100 && response.status < 200);
        if (!LinkFetchRules.isSuccess(response.status)) return response;

        InputStream body = chunked ? new ChunkedInput(in) : length >= 0 ? new LimitedInput(in, length) : in;
        response.body = readBody(body, maxBytes, allowCut, deadline);
        return response;
    }

    /** One line of the head, without its line break */
    private static String line(InputStream in, int[] headerBytes) throws IOException {
        ByteArrayOutputStream text = new ByteArrayOutputStream();
        for (;;) {
            int b = in.read();
            if (b < 0) throw new IOException("The answer stopped early");
            if (++headerBytes[0] > MAX_HEADER_BYTES) throw new IOException("The answer's head is too long");
            if (b == '\n') break;
            if (b != '\r') text.write(b);
        }
        return text.toString(StandardCharsets.ISO_8859_1.name());
    }

    /** The first `maxBytes`, or null when there is more and it may not be cut */
    private static byte[] readBody(InputStream in, int maxBytes, boolean allowCut, long deadline) throws IOException {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        byte[] chunk = new byte[16 * 1024];
        while (body.size() < maxBytes) {
            if (System.currentTimeMillis() > deadline) throw new IOException("the site answers too slowly");
            int count = in.read(chunk, 0, Math.min(chunk.length, maxBytes - body.size()));
            if (count < 0) return body.toByteArray();
            body.write(chunk, 0, count);
        }
        // exactly as long as allowed, or longer?
        if (allowCut || in.read() < 0) return body.toByteArray();
        return null;
    }

    /** A body of a known length: what follows it isn't part of it */
    private static final class LimitedInput extends InputStream {

        private final InputStream in;
        private long left;

        LimitedInput(InputStream in, long length) {
            this.in = in;
            this.left = length;
        }

        @Override
        public int read() throws IOException {
            if (left <= 0) return -1;
            int b = in.read();
            if (b < 0) throw new IOException("The answer stopped early");
            left--;
            return b;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (left <= 0) return -1;
            int read = in.read(buffer, offset, (int) Math.min(count, left));
            if (read < 0) throw new IOException("The answer stopped early");
            left -= read;
            return read;
        }
    }

    /** A body sent in chunks, each after its length in hex */
    private static final class ChunkedInput extends InputStream {

        private final InputStream in;
        private long left = 0;
        private boolean done = false;

        ChunkedInput(InputStream in) {
            this.in = in;
        }

        private boolean nextChunk() throws IOException {
            if (done) return false;
            if (left == 0) {
                String size = line(in, new int[] { 0 }).split(";", 2)[0].trim();
                try {
                    left = Long.parseLong(size, 16);
                } catch (NumberFormatException garbled) {
                    throw new IOException("A garbled chunk");
                }
                if (left < 0) throw new IOException("A garbled chunk");
                if (left == 0) {
                    done = true;
                    return false;
                }
            }
            return true;
        }

        @Override
        public int read() throws IOException {
            byte[] one = new byte[1];
            return read(one, 0, 1) < 0 ? -1 : one[0] & 0xff;
        }

        @Override
        public int read(byte[] buffer, int offset, int count) throws IOException {
            if (!nextChunk()) return -1;
            int read = in.read(buffer, offset, (int) Math.min(count, left));
            if (read < 0) throw new IOException("The answer stopped early");
            left -= read;
            // the line break that ends a chunk
            if (left == 0 && !line(in, new int[] { 0 }).isEmpty()) throw new IOException("A garbled chunk");
            return read;
        }
    }
}
