package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.function.Predicate;
import org.junit.After;
import org.junit.Test;

/**
 * The whole transport over real loopback sockets: the listener, the dialer
 * and the connections between them, plus raw clients that misbehave in the
 * ways a stranger on the network might.
 */
public class SyncNetworkTest {

    /** Events as lines such as "opened 1 127.0.0.1 false", in the order they came */
    private static final class Recorder implements SyncNetwork.Events {

        final BlockingQueue<String> lines = new LinkedBlockingQueue<>();

        @Override
        public void opened(int id, String address, boolean initiator) {
            lines.add("opened " + id + " " + address + " " + initiator);
        }

        @Override
        public void message(int id, String text) {
            lines.add("message " + id + " " + text);
        }

        @Override
        public void closed(int id, String reason) {
            lines.add("closed " + id + " " + reason);
        }

        @Override
        public void error(String what, Throwable error) {
            lines.add("error " + what + " " + error);
        }

        String next() throws InterruptedException {
            String line = lines.poll(5, TimeUnit.SECONDS);
            assertNotNull("an event was due", line);
            return line;
        }

        /** The next event, which must start with `start` */
        String next(String start) throws InterruptedException {
            String line = next();
            assertTrue("expected '" + start + "' but got '" + line + "'", line.startsWith(start));
            return line;
        }

        void assertQuiet(long ms) throws InterruptedException {
            assertNull("nothing was due", lines.poll(ms, TimeUnit.MILLISECONDS));
        }
    }

    private static final Predicate<String> ANY = address -> true;

    private final List<SyncNetwork> networks = new ArrayList<>();
    private final List<Socket> sockets = new ArrayList<>();

    @After
    public void tearDown() throws IOException {
        for (SyncNetwork network : networks) network.stopNow();
        for (Socket socket : sockets) socket.close();
    }

    private SyncNetwork network(SyncLimits limits, Predicate<String> isLocal, Recorder recorder, int... ports) {
        SyncNetwork network = new SyncNetwork(ports.length == 0 ? new int[] { 0 } : ports, limits, isLocal, recorder);
        networks.add(network);
        return network;
    }

    private SyncLimits quick() {
        SyncLimits limits = SyncLimits.defaults();
        limits.closeGraceMs = 300;
        return limits;
    }

    // --- a raw client, for what a proper one would not do

    private final class Raw {

        final Socket socket;
        final InputStream in;
        final OutputStream out;

        Raw(int port) throws IOException {
            socket = new Socket("127.0.0.1", port);
            socket.setSoTimeout(5000);
            sockets.add(socket);
            in = new java.io.BufferedInputStream(socket.getInputStream());
            out = socket.getOutputStream();
        }

        /** Sends an upgrade request and returns the status line of the answer */
        String upgrade() throws IOException {
            String key = WebSocketHandshake.newKey();
            out.write(WebSocketHandshake.clientRequest("127.0.0.1", key));
            WebSocketHandshake.Head head = WebSocketHandshake.readHead(socket, in, 8192, System.currentTimeMillis() + 5000);
            return head.firstLine;
        }

        String request(String text) throws IOException {
            out.write(text.getBytes(StandardCharsets.US_ASCII));
            return WebSocketHandshake.readHead(socket, in, 8192, System.currentTimeMillis() + 5000).firstLine;
        }

        void frame(boolean fin, int opcode, byte[] payload, boolean masked) throws IOException {
            byte[] whole = WebSocketFrames.encode(opcode, payload, masked);
            if (!fin) whole[0] &= 0x7F;
            out.write(whole);
            out.flush();
        }

        void text(String text) throws IOException {
            frame(true, WebSocketFrames.TEXT, text.getBytes(StandardCharsets.UTF_8), true);
        }

        WebSocketFrames.Frame read() throws IOException {
            return new WebSocketFrames.Reader(in, false, 1_000_000).read();
        }

        int closeCodeReceived() throws IOException {
            WebSocketFrames.Frame frame = read();
            assertEquals(WebSocketFrames.CLOSE, frame.opcode);
            return WebSocketFrames.closeCode(frame.payload);
        }
    }

    private Raw connectedRaw(int port) throws IOException {
        Raw raw = new Raw(port);
        assertTrue(raw.upgrade().startsWith("HTTP/1.1 101"));
        return raw;
    }

    // --- two networks talking

    @Test
    public void twoNetworksExchangeMessagesBothWays() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncNetwork a = network(quick(), ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int port = a.start();
        assertTrue(port > 0);

        int dialed = b.connect("127.0.0.1:" + port);
        assertEquals("opened " + dialed + " 127.0.0.1:" + port + " true", dialing.next());
        String opened = listening.next("opened");
        assertTrue(opened.endsWith(" 127.0.0.1 false"));
        int accepted = Integer.parseInt(opened.split(" ")[1]);

        assertTrue(b.send(dialed, "héllo ✓ {\"t\":\"hello\"}"));
        assertEquals("message " + accepted + " héllo ✓ {\"t\":\"hello\"}", listening.next());
        assertTrue(a.send(accepted, "back"));
        assertEquals("message " + dialed + " back", dialing.next());
    }

    @Test
    public void aLargeMessageGoesThroughWhole() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncNetwork a = network(quick(), ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int dialed = b.connect("127.0.0.1:" + a.start());
        dialing.next("opened");
        listening.next("opened");

        String big = "x".repeat(5 * 1024 * 1024);
        assertTrue(b.send(dialed, big));
        assertEquals(big.length() + "message 1 ".length(), listening.next("message").length());
    }

    @Test
    public void messagesAreDeliveredInOrderAndTheCloseComesAfterThem() throws Exception {
        Recorder recorder = new Recorder();
        int port = network(quick(), ANY, recorder).start();
        Raw raw = connectedRaw(port);
        recorder.next("opened");
        for (int i = 0; i < 20; i++) raw.text("m" + i);
        raw.frame(true, WebSocketFrames.CLOSE, WebSocketFrames.closePayload(1000, "bye"), true);
        for (int i = 0; i < 20; i++) assertTrue(recorder.next("message").endsWith(" m" + i));
        assertTrue(recorder.next("closed").endsWith(" bye"));
    }

    @Test
    public void aCloseReasonReachesTheOtherSide() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncNetwork a = network(quick(), ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int dialed = b.connect("127.0.0.1:" + a.start());
        dialing.next("opened");
        listening.next("opened");

        b.close(dialed, "auth");
        assertTrue("the other side is told why", listening.next("closed").endsWith(" auth"));
        dialing.next("closed"); // and this side's own end follows
        assertEquals(0, a.connectionCount());
        assertEquals(0, b.connectionCount());
    }

    @Test
    public void whatWasSentBeforeAClosePrecedesIt() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncNetwork a = network(quick(), ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int dialed = b.connect("127.0.0.1:" + a.start());
        dialing.next("opened");
        listening.next("opened");
        b.send(dialed, "last words");
        b.close(dialed, "done");
        listening.next("message");
        assertTrue(listening.next("closed").endsWith(" done"));
        assertFalse("nothing can be sent after a close", b.send(dialed, "too late"));
    }

    @Test
    public void aPeerThatVanishesIsToldAsAnEndWithNoReason() throws Exception {
        Recorder recorder = new Recorder();
        int port = network(quick(), ANY, recorder).start();
        Raw raw = connectedRaw(port);
        recorder.next("opened");
        raw.socket.close();
        assertTrue(recorder.next("closed").matches("closed \\d+ "));
    }

    // --- what the listener refuses

    @Test
    public void aPingIsAnsweredWithTheSamePayload() throws Exception {
        Recorder recorder = new Recorder();
        Raw raw = connectedRaw(network(quick(), ANY, recorder).start());
        raw.frame(true, WebSocketFrames.PING, "are you there".getBytes(StandardCharsets.UTF_8), true);
        WebSocketFrames.Frame pong = raw.read();
        assertEquals(WebSocketFrames.PONG, pong.opcode);
        assertEquals("are you there", new String(pong.payload, StandardCharsets.UTF_8));
    }

    @Test
    public void aFragmentedMessageArrivesAsOne() throws Exception {
        Recorder recorder = new Recorder();
        Raw raw = connectedRaw(network(quick(), ANY, recorder).start());
        recorder.next("opened");
        raw.frame(false, WebSocketFrames.TEXT, "one ".getBytes(StandardCharsets.UTF_8), true);
        raw.frame(true, WebSocketFrames.PING, new byte[0], true); // a ping may come between
        raw.frame(false, WebSocketFrames.CONTINUATION, "two ".getBytes(StandardCharsets.UTF_8), true);
        raw.frame(true, WebSocketFrames.CONTINUATION, "three".getBytes(StandardCharsets.UTF_8), true);
        assertTrue(recorder.next("message").endsWith(" one two three"));
    }

    @Test
    public void whatBreaksTheRulesIsToldWhyAndEnded() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.maxMessageBytes = 100;
        int port = network(limits, ANY, recorder).start();

        Raw binary = connectedRaw(port);
        binary.frame(true, WebSocketFrames.BINARY, new byte[3], true);
        assertEquals(1003, binary.closeCodeReceived());

        Raw notUtf8 = connectedRaw(port);
        notUtf8.frame(true, WebSocketFrames.TEXT, new byte[] { (byte) 0xFF, (byte) 0xFE }, true);
        assertEquals(1007, notUtf8.closeCodeReceived());

        Raw tooBig = connectedRaw(port);
        tooBig.text("y".repeat(101));
        assertEquals(1009, tooBig.closeCodeReceived());

        Raw unmasked = connectedRaw(port);
        unmasked.frame(true, WebSocketFrames.TEXT, new byte[3], false);
        assertEquals(1002, unmasked.closeCodeReceived());

        // and each of the four is closed on this side too
        for (int i = 0; i < 4; i++) {
            while (true) {
                String line = recorder.next();
                if (line.startsWith("closed")) break;
            }
        }
    }

    @Test
    public void anAddressOutsideTheLocalNetworkGets403() throws Exception {
        Recorder recorder = new Recorder();
        int port = network(quick(), address -> false, recorder).start();
        Raw raw = new Raw(port);
        assertTrue(raw.upgrade().startsWith("HTTP/1.1 403"));
        recorder.assertQuiet(200);
    }

    @Test
    public void anOrdinaryWebRequestIsToldToUpgrade() throws Exception {
        Recorder recorder = new Recorder();
        Raw raw = new Raw(network(quick(), ANY, recorder).start());
        assertTrue(raw.request("GET / HTTP/1.1\r\nHost: x\r\n\r\n").startsWith("HTTP/1.1 426"));
    }

    @Test
    public void garbageGets400AndCounts() throws Exception {
        Recorder recorder = new Recorder();
        int port = network(quick(), ANY, recorder).start();
        assertTrue(new Raw(port).request("this is not http\r\n\r\n").startsWith("HTTP/1.1 400"));
    }

    @Test
    public void fiveFailedHandshakesBlockTheAddressForAWhile() throws Exception {
        Recorder recorder = new Recorder();
        SyncNetwork network = network(quick(), ANY, recorder);
        int port = network.start();
        for (int i = 0; i < 4; i++) network.handshakeFailed("127.0.0.1"); // the sync core's report
        assertTrue(connectedRaw(port) != null);
        network.handshakeFailed("127.0.0.1");
        assertTrue(new Raw(port).upgrade().startsWith("HTTP/1.1 429"));
    }

    @Test
    public void breakingTheRulesRightAfterOpeningCountsAsAFailedHandshake() throws Exception {
        Recorder recorder = new Recorder();
        int port = network(quick(), ANY, recorder).start();
        for (int i = 0; i < 5; i++) {
            Raw raw = connectedRaw(port);
            raw.frame(true, WebSocketFrames.TEXT, new byte[1], false); // unmasked: a violation
            raw.closeCodeReceived();
            while (!recorder.next().startsWith("closed")) {
                // opened, then closed
            }
        }
        assertTrue(new Raw(port).upgrade().startsWith("HTTP/1.1 429"));
    }

    @Test
    public void connectionsOverTheLimitGet503() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.maxInbound = 2;
        int port = network(limits, ANY, recorder).start();
        connectedRaw(port);
        connectedRaw(port);
        assertTrue(new Raw(port).upgrade().startsWith("HTTP/1.1 503"));
    }

    @Test
    public void aSlotIsFreeAgainWhenItsConnectionEnds() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.maxInbound = 1;
        int port = network(limits, ANY, recorder).start();
        Raw first = connectedRaw(port);
        recorder.next("opened");
        assertTrue(new Raw(port).upgrade().startsWith("HTTP/1.1 503"));
        first.socket.close();
        recorder.next("closed");
        assertTrue(connectedRaw(port) != null);
    }

    @Test
    public void aClientThatSendsNoRequestIsDroppedAndCounted() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.requestTimeoutMs = 300;
        SyncNetwork network = network(limits, ANY, recorder);
        int port = network.start();
        long start = System.currentTimeMillis();
        Raw silent = new Raw(port);
        // the answer is a 400 and the end of the connection, not a hang
        assertTrue(WebSocketHandshake.readHead(silent.socket, silent.in, 8192, System.currentTimeMillis() + 5000).firstLine.startsWith("HTTP/1.1 400"));
        assertTrue(System.currentTimeMillis() - start < 3000);
    }

    @Test
    public void aClientThatTricklesItsRequestIsCutAtTheDeadline() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.requestTimeoutMs = 500;
        int port = network(limits, ANY, recorder).start();
        Raw slow = new Raw(port);
        long start = System.currentTimeMillis();
        // one byte every 100 ms never finishes the head before the deadline
        try {
            for (int i = 0; i < 40; i++) {
                slow.out.write('G');
                slow.out.flush();
                Thread.sleep(100);
            }
        } catch (IOException cut) {
            // the listener ended it
        }
        assertTrue(System.currentTimeMillis() - start < 3000);
    }

    @Test
    public void aConnectionThatGoesSilentIsDropped() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.idleTimeoutMs = 300;
        int port = network(limits, ANY, recorder).start();
        connectedRaw(port);
        recorder.next("opened");
        long start = System.currentTimeMillis();
        assertTrue(recorder.next("closed").matches("closed \\d+ "));
        assertTrue(System.currentTimeMillis() - start < 3000);
    }

    @Test
    public void whatCannotBeSentFastEnoughEndsTheConnection() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncLimits limits = quick();
        limits.maxQueuedBytes = 1000;
        SyncNetwork a = network(limits, ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int dialed = b.connect("127.0.0.1:" + a.start());
        dialing.next("opened");
        String opened = listening.next("opened");
        int accepted = Integer.parseInt(opened.split(" ")[1]);

        assertFalse(a.send(accepted, "z".repeat(2000)));
        assertTrue(listening.next("closed").matches("closed \\d+ "));
        assertTrue(dialing.next("closed").startsWith("closed " + dialed));
    }

    @Test
    public void aMessageOverTheLimitIsNotSentAtAll() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncLimits limits = quick();
        limits.maxMessageBytes = 50;
        SyncNetwork a = network(limits, ANY, listening);
        SyncNetwork b = network(limits, ANY, dialing);
        int dialed = b.connect("127.0.0.1:" + a.start());
        dialing.next("opened");
        listening.next("opened");
        assertFalse(b.send(dialed, "z".repeat(51)));
        assertTrue(b.send(dialed, "z".repeat(50)));
        assertTrue(listening.next("message").endsWith("z".repeat(50)));
    }

    // --- listening and dialing

    @Test
    public void theFirstFreePortIsTaken() throws Exception {
        try (ServerSocket taken = new ServerSocket()) {
            taken.bind(new InetSocketAddress("0.0.0.0", 0));
            SyncNetwork network = network(quick(), ANY, new Recorder(), taken.getLocalPort(), 0);
            int port = network.start();
            assertTrue(port > 0);
            assertTrue(port != taken.getLocalPort());
        }
    }

    @Test
    public void whenNoPortIsFreeItSaysSo() throws Exception {
        try (ServerSocket taken = new ServerSocket()) {
            taken.bind(new InetSocketAddress("0.0.0.0", 0));
            assertEquals(-1, network(quick(), ANY, new Recorder(), taken.getLocalPort()).start());
        }
    }

    @Test
    public void stoppingFreesThePortAndEndsEveryConnection() throws Exception {
        Recorder recorder = new Recorder();
        SyncNetwork network = network(quick(), ANY, recorder);
        int port = network.start();
        Raw raw = connectedRaw(port);
        recorder.next("opened");

        network.stop();
        assertEquals("the connection is closed properly", 1000, raw.closeCodeReceived());
        recorder.next("closed");
        // the port can be listened on again
        long deadline = System.currentTimeMillis() + 3000;
        while (true) {
            try (ServerSocket again = new ServerSocket()) {
                again.setReuseAddress(true);
                again.bind(new InetSocketAddress("0.0.0.0", port));
                break;
            } catch (IOException stillBusy) {
                assertTrue("the port was freed", System.currentTimeMillis() < deadline);
                Thread.sleep(50);
            }
        }
    }

    @Test
    public void aRefusedDialIsALoneClose() throws Exception {
        Recorder recorder = new Recorder();
        SyncNetwork network = network(quick(), ANY, recorder);
        int free;
        try (ServerSocket probe = new ServerSocket(0)) {
            free = probe.getLocalPort();
        }
        int id = network.connect("127.0.0.1:" + free);
        assertEquals("closed " + id + " ", recorder.next());
        recorder.assertQuiet(200);
    }

    @Test
    public void onlyLocalAddressesAreDialed() throws Exception {
        Recorder recorder = new Recorder();
        SyncNetwork network = network(quick(), LocalAddress::isLocalNetwork, recorder);
        int one = network.connect("8.8.8.8:47823");
        assertEquals("closed " + one + " ", recorder.next());
        int two = network.connect("not an address");
        assertEquals("closed " + two + " ", recorder.next());
        int three = network.connect("10.0.0.1:99999");
        assertEquals("closed " + three + " ", recorder.next());
        recorder.assertQuiet(200);
    }

    @Test
    public void aServerThatDoesNotUpgradeIsALoneClose() throws Exception {
        Recorder recorder = new Recorder();
        SyncNetwork network = network(quick(), ANY, recorder);
        try (ServerSocket web = new ServerSocket(0)) {
            Thread server = new Thread(() -> {
                try (Socket client = web.accept()) {
                    client.getInputStream().read(new byte[512]);
                    client.getOutputStream().write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n".getBytes(StandardCharsets.US_ASCII));
                } catch (IOException ignored) {
                    // the test ended
                }
            });
            server.setDaemon(true);
            server.start();
            int id = network.connect("127.0.0.1:" + web.getLocalPort());
            assertEquals("closed " + id + " ", recorder.next());
        }
    }

    @Test
    public void aSilentServerIsGivenUpOn() throws Exception {
        Recorder recorder = new Recorder();
        SyncLimits limits = quick();
        limits.requestTimeoutMs = 300;
        SyncNetwork network = network(limits, ANY, recorder);
        try (ServerSocket silent = new ServerSocket(0)) {
            long start = System.currentTimeMillis();
            int id = network.connect("127.0.0.1:" + silent.getLocalPort());
            assertEquals("closed " + id + " ", recorder.next());
            assertTrue(System.currentTimeMillis() - start < 3000);
        }
    }

    @Test
    public void connectionNumbersAreNeverReused() throws Exception {
        Recorder listening = new Recorder();
        Recorder dialing = new Recorder();
        SyncNetwork a = network(quick(), ANY, listening);
        SyncNetwork b = network(quick(), ANY, dialing);
        int port = a.start();
        List<Integer> ids = new ArrayList<>();
        for (int i = 0; i < 3; i++) {
            int id = b.connect("127.0.0.1:" + port);
            assertFalse(ids.contains(id));
            ids.add(id);
            dialing.next("opened");
            b.close(id, "");
            dialing.next("closed");
        }
    }
}
