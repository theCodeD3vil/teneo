package com.michael.teneo.sync;

import java.io.BufferedInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.BindException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.SocketTimeoutException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.LongSupplier;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * The phone's side of the sync transport: listens for other devices on the
 * first free sync port, dials the ones discovery finds, and hands each
 * connection to the sync core as numbered text messages. It decides nothing
 * about what is said: what runs the connection's protocol is the page.
 *
 * What the Mac does in lan-transport.ts, this does too: connections from
 * outside the local network are refused (403), an address that fails
 * handshakes too often is refused for a while (429), so are connections over
 * the limit (503), and anything that is not a WebSocket upgrade is told to
 * upgrade (426).
 *
 * Pure Java, so it runs in unit tests. Events arrive on whichever thread
 * noticed them, in order for any one connection.
 */
final class SyncNetwork {

    interface Events {
        /** A connection is ready: `initiator` is true when this phone dialed. For
         *  a dialed one `address` is host:port, for one that came in just the host. */
        void opened(int id, String address, boolean initiator);

        void message(int id, String text);

        /** Always follows `opened`; for a dial that never opened it comes alone */
        void closed(int id, String reason);

        /** Something unexpected, never an ordinary refusal or disconnect */
        void error(String what, Throwable error);
    }

    private static final Pattern HOST_PORT = Pattern.compile("^(\\d{1,3}(?:\\.\\d{1,3}){3}):(\\d{1,5})$");

    private final int[] ports;
    private final SyncLimits limits;
    private final Predicate<String> isLocal;
    private final Events events;
    private final FailureLedger ledger;

    private final ExecutorService workers = Executors.newCachedThreadPool(runnable -> {
        Thread thread = new Thread(runnable, "teneo-sync-worker");
        thread.setDaemon(true);
        return thread;
    });
    private final ScheduledThreadPoolExecutor timers = new ScheduledThreadPoolExecutor(1, runnable -> {
        Thread thread = new Thread(runnable, "teneo-sync-timers");
        thread.setDaemon(true);
        return thread;
    });
    private final Map<Integer, Connection> connections = new ConcurrentHashMap<>();
    private final AtomicInteger nextId = new AtomicInteger(1);
    private final AtomicInteger inbound = new AtomicInteger();

    private volatile ServerSocket server;
    private volatile boolean stopped;

    private static final class Connection {

        final boolean initiator;
        final String address;
        final long openedAt = System.currentTimeMillis();
        volatile WebSocketConnection socket;

        Connection(boolean initiator, String address) {
            this.initiator = initiator;
            this.address = address;
        }
    }

    SyncNetwork(int[] ports, SyncLimits limits, Predicate<String> isLocal, Events events) {
        this(ports, limits, isLocal, events, System::currentTimeMillis);
    }

    SyncNetwork(int[] ports, SyncLimits limits, Predicate<String> isLocal, Events events, LongSupplier clock) {
        this.ports = ports;
        this.limits = limits;
        this.isLocal = isLocal;
        this.events = events;
        this.ledger = new FailureLedger(limits.failureCount, limits.failureWindowMs, clock);
        // a write's watchdog is cancelled almost every time: don't keep the husks
        timers.setRemoveOnCancelPolicy(true);
    }

    /** Listens on the first free of the ports, and returns it: -1 when none was free */
    int start() {
        for (int port : ports) {
            ServerSocket candidate = null;
            try {
                // IPv4 only, like the Mac: that is where Bonjour points other devices
                candidate = new ServerSocket();
                candidate.setReuseAddress(true);
                candidate.bind(new InetSocketAddress(InetAddress.getByName("0.0.0.0"), port));
            } catch (BindException taken) {
                closeQuietly(candidate);
                continue;
            } catch (IOException error) {
                closeQuietly(candidate);
                events.error("listen on " + port, error);
                continue;
            }
            server = candidate;
            ServerSocket listening = candidate;
            workers.execute(() -> acceptLoop(listening));
            return candidate.getLocalPort();
        }
        return -1;
    }

    /** Ends every connection politely and stops listening. Returns at once;
     *  what has not closed itself within a moment is cut. */
    void stop() {
        stopped = true;
        closeQuietly(server);
        for (Connection connection : connections.values()) {
            WebSocketConnection socket = connection.socket;
            if (socket != null) socket.close("");
        }
        timers.schedule(this::stopNow, limits.closeGraceMs, TimeUnit.MILLISECONDS);
    }

    /** Cuts everything now */
    void stopNow() {
        stopped = true;
        closeQuietly(server);
        for (Connection connection : connections.values()) {
            WebSocketConnection socket = connection.socket;
            if (socket != null) socket.abort();
        }
        workers.shutdownNow();
        timers.shutdownNow();
    }

    boolean send(int id, String text) {
        Connection connection = connections.get(id);
        WebSocketConnection socket = connection == null ? null : connection.socket;
        return socket != null && socket.send(text);
    }

    void close(int id, String reason) {
        Connection connection = connections.get(id);
        WebSocketConnection socket = connection == null ? null : connection.socket;
        if (socket != null) socket.close(reason);
    }

    /** The sync core says a connection from `address` failed its handshake */
    void handshakeFailed(String address) {
        ledger.record(address);
    }

    int connectionCount() {
        return connections.size();
    }

    // --- listening

    private void acceptLoop(ServerSocket listening) {
        while (!stopped && !listening.isClosed()) {
            try {
                Socket socket = listening.accept();
                try {
                    workers.execute(() -> receive(socket));
                } catch (RuntimeException rejected) {
                    closeQuietly(socket); // stopping
                }
            } catch (IOException error) {
                if (!stopped && !listening.isClosed()) events.error("accept", error);
            }
        }
    }

    /** A new connection: filter it, read its upgrade request, answer */
    private void receive(Socket socket) {
        boolean counted = false;
        boolean handedOver = false;
        String address = "";
        try {
            address = addressOf(socket);
            if (!isLocal.test(address)) {
                refuse(socket, 403, "Forbidden", "Forbidden", "");
                return;
            }
            if (ledger.isBlocked(address)) {
                refuse(socket, 429, "Too Many Requests", "Too many tries", "");
                return;
            }
            if (inbound.incrementAndGet() > limits.maxInbound) {
                inbound.decrementAndGet();
                refuse(socket, 503, "Service Unavailable", "Busy", "");
                return;
            }
            counted = true;

            InputStream in = new BufferedInputStream(socket.getInputStream());
            WebSocketHandshake.Head head;
            try {
                head = WebSocketHandshake.readHead(socket, in, limits.maxRequestBytes, System.currentTimeMillis() + limits.requestTimeoutMs);
            } catch (ProtocolViolation | SocketTimeoutException error) {
                // not a request, or not one in time: a failed attempt
                ledger.record(address);
                refuse(socket, 400, "Bad Request", "Bad request", "");
                return;
            }

            WebSocketHandshake.Verdict verdict = WebSocketHandshake.judge(head);
            if (verdict == WebSocketHandshake.Verdict.NOT_AN_UPGRADE) {
                refuse(socket, 426, "Upgrade Required", "Teneo sync", "Upgrade: websocket\r\n");
                return;
            }
            if (verdict == WebSocketHandshake.Verdict.BAD) {
                ledger.record(address);
                refuse(socket, 400, "Bad Request", "Bad request", "Sec-WebSocket-Version: 13\r\n");
                return;
            }
            socket.getOutputStream().write(WebSocketHandshake.upgradeResponse(head.headers.get("sec-websocket-key")));
            socket.getOutputStream().flush();

            open(nextId.getAndIncrement(), socket, in, false, address);
            handedOver = true;
        } catch (IOException error) {
            // the other side went away mid-way: nothing to report
        } finally {
            if (!handedOver) {
                closeQuietly(socket);
                if (counted) inbound.decrementAndGet();
            }
        }
    }

    private void refuse(Socket socket, int status, String reason, String body, String extraHeaders) {
        try {
            socket.setSoTimeout(1000);
            socket.getOutputStream().write(WebSocketHandshake.statusResponse(status, reason, body, extraHeaders));
            socket.getOutputStream().flush();
        } catch (IOException ignored) {
            // it left
        }
    }

    // --- dialing

    /** Dials `host:port`; the result is an `opened` or a lone `closed` for the
     *  returned id. Only addresses of the local network are dialed. */
    int connect(String hostPort) {
        int id = nextId.getAndIncrement();
        try {
            workers.execute(() -> dial(id, hostPort));
        } catch (RuntimeException rejected) {
            events.closed(id, ""); // stopping
        }
        return id;
    }

    private void dial(int id, String hostPort) {
        Socket socket = new Socket();
        boolean handedOver = false;
        try {
            Matcher match = HOST_PORT.matcher(hostPort);
            if (!match.matches() || !isLocal.test(match.group(1))) return;
            int port = Integer.parseInt(match.group(2));
            if (port < 1 || port > 65535) return;
            socket.connect(new InetSocketAddress(match.group(1), port), limits.connectTimeoutMs);

            String key = WebSocketHandshake.newKey();
            socket.getOutputStream().write(WebSocketHandshake.clientRequest(hostPort, key));
            socket.getOutputStream().flush();
            InputStream in = new BufferedInputStream(socket.getInputStream());
            WebSocketHandshake.checkResponse(
                WebSocketHandshake.readHead(socket, in, limits.maxRequestBytes, System.currentTimeMillis() + limits.requestTimeoutMs),
                key
            );
            if (stopped) return;
            open(id, socket, in, true, hostPort);
            handedOver = true;
        } catch (IOException error) {
            // unreachable, refused, or not a device of ours: an ordinary failure
        } finally {
            if (!handedOver) {
                closeQuietly(socket);
                events.closed(id, "");
            }
        }
    }

    // --- an open connection

    /** Takes the socket over: from here on `closed` is told for `id` */
    private void open(int id, Socket socket, InputStream in, boolean initiator, String address) throws IOException {
        Connection connection = new Connection(initiator, address);
        WebSocketConnection ws = new WebSocketConnection(
            socket,
            in,
            initiator,
            limits,
            timers,
            new WebSocketConnection.Listener() {
                @Override
                public void onMessage(String text) {
                    events.message(id, text);
                }

                @Override
                public void onClose(String reason, boolean violation) {
                    connections.remove(id);
                    if (!initiator) {
                        inbound.decrementAndGet();
                        // breaking the rules right after opening is a failed handshake
                        if (violation && System.currentTimeMillis() - connection.openedAt < limits.handshakeWindowMs) {
                            ledger.record(address);
                        }
                    }
                    events.closed(id, reason);
                }
            },
            String.valueOf(id)
        );
        connection.socket = ws;
        connections.put(id, connection);
        // the page learns of the connection before any message from it
        events.opened(id, address, initiator);
        try {
            ws.start();
        } catch (IOException error) {
            ws.abort(); // told as closed, like any other end
        }
    }

    private static String addressOf(Socket socket) {
        String host = socket.getInetAddress().getHostAddress();
        int zone = host.indexOf('%'); // fe80::1%wlan0
        return zone < 0 ? host : host.substring(0, zone);
    }

    private static void closeQuietly(java.io.Closeable closeable) {
        if (closeable == null) return;
        try {
            closeable.close();
        } catch (IOException ignored) {
            // already closed
        }
    }
}
