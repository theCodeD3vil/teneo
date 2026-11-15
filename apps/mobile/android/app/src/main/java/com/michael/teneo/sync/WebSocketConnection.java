package com.michael.teneo.sync;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicLong;

/**
 * An open WebSocket, after the upgrade, for either end. Text messages in and
 * out; pings answered; the close handshake done properly; everything past a
 * limit ends the connection (SyncLimits).
 *
 * One thread reads. One writes, from a queue, so `send` never waits on the
 * network: the page that calls it must not stall because a device stopped
 * reading. A write that takes too long closes the socket instead.
 *
 * The listener is called from whichever thread noticed, so it must be quick
 * and thread-safe. `onClose` is called exactly once, after every message.
 */
final class WebSocketConnection {

    interface Listener {
        void onMessage(String text);

        /**
         * @param reason the other side's close reason, or ours when we closed
         *               first, or "" when the connection just ended
         * @param violation the other side broke the WebSocket rules
         */
        void onClose(String reason, boolean violation);
    }

    private static final byte[] STOP = new byte[0];

    private final Socket socket;
    private final InputStream in;
    private final OutputStream out;
    private final boolean isClient;
    private final SyncLimits limits;
    private final ScheduledExecutorService timers;
    private final Listener listener;
    private final String name;

    private final LinkedBlockingQueue<byte[]> queue = new LinkedBlockingQueue<>();
    private final AtomicLong queuedBytes = new AtomicLong();
    private final AtomicBoolean finished = new AtomicBoolean();
    private final Object closing = new Object();

    // guarded by `closing`
    private boolean closeQueued;
    private byte[] closeFrame;
    private boolean closeWritten;
    private boolean closeReceived;
    private String closeReason = "";
    private boolean violation;
    private boolean abandoned;

    /**
     * @param in the stream the head was read from, so no byte is lost
     */
    WebSocketConnection(
        Socket socket,
        InputStream in,
        boolean isClient,
        SyncLimits limits,
        ScheduledExecutorService timers,
        Listener listener,
        String name
    ) throws IOException {
        this.socket = socket;
        this.in = in;
        this.out = socket.getOutputStream();
        this.isClient = isClient;
        this.limits = limits;
        this.timers = timers;
        this.listener = listener;
        this.name = name;
    }

    void start() throws IOException {
        socket.setSoTimeout((int) limits.idleTimeoutMs);
        socket.setTcpNoDelay(true);
        socket.setKeepAlive(true);
        thread("read", this::readLoop);
        thread("write", this::writeLoop);
    }

    private void thread(String role, Runnable work) {
        Thread thread = new Thread(work, "teneo-ws-" + role + "-" + name);
        thread.setDaemon(true);
        thread.start();
    }

    /** Queues a text message. False when it can't be sent: the connection is
     *  closing, the message is over the limit, or too much is waiting. */
    boolean send(String text) {
        byte[] payload = text.getBytes(StandardCharsets.UTF_8);
        if (payload.length > limits.maxMessageBytes) return false;
        return enqueue(WebSocketFrames.encode(WebSocketFrames.TEXT, payload, isClient));
    }

    /** Ends the connection politely: a close frame, then the other side's.
     *  Whatever was queued before is still sent. */
    void close(String reason) {
        closeWith(WebSocketFrames.NORMAL_CLOSURE, reason);
    }

    /** Ends it now, with no close frame */
    void abort() {
        finish("", false);
    }

    boolean isOpen() {
        return !finished.get();
    }

    private boolean enqueue(byte[] frame) {
        synchronized (closing) {
            if (finished.get() || closeQueued) return false;
            if (queuedBytes.addAndGet(frame.length) > limits.maxQueuedBytes) {
                queuedBytes.addAndGet(-frame.length);
                // the other side isn't reading; there is no polite way left
                timers.execute(() -> finish("", false));
                return false;
            }
            queue.add(frame);
            return true;
        }
    }

    private void closeWith(int code, String reason) {
        synchronized (closing) {
            if (finished.get() || closeQueued) return;
            closeQueued = true;
            if (closeReason.isEmpty()) closeReason = reason == null ? "" : reason;
            closeFrame = WebSocketFrames.encode(WebSocketFrames.CLOSE, WebSocketFrames.closePayload(code, reason), isClient);
            queue.add(closeFrame);
        }
    }

    // --- reading

    private void readLoop() {
        WebSocketFrames.Reader reader = new WebSocketFrames.Reader(in, !isClient, limits.maxMessageBytes);
        WebSocketFrames.Assembler assembler = new WebSocketFrames.Assembler(limits.maxMessageBytes);
        try {
            while (!finished.get()) {
                WebSocketFrames.Frame frame = reader.read();
                switch (frame.opcode) {
                    case WebSocketFrames.PING:
                        // a pong carries the ping's payload back; one after a close is pointless
                        enqueue(WebSocketFrames.encode(WebSocketFrames.PONG, frame.payload, isClient));
                        break;
                    case WebSocketFrames.PONG:
                        break;
                    case WebSocketFrames.CLOSE:
                        receivedClose(frame.payload);
                        return;
                    default:
                        String message = assembler.add(frame);
                        if (message != null) listener.onMessage(message);
                }
            }
        } catch (ProtocolViolation error) {
            synchronized (closing) {
                violation = true;
                abandoned = true;
            }
            closeWith(error.closeCode, error.getMessage());
            // the close is written, then the connection ends: no more reading
            // from someone who broke the rules
            timers.schedule(() -> finish("", true), limits.closeGraceMs, TimeUnit.MILLISECONDS);
        } catch (IOException error) {
            // an end without a close frame, a timeout, a reset
            finish("", false);
        } catch (RuntimeException error) {
            // the listener failed: nobody is handling this connection any more
            finish("", false);
        }
    }

    private void receivedClose(byte[] payload) throws IOException {
        String reason = WebSocketFrames.closeReason(payload);
        WebSocketFrames.closeCode(payload); // refuses a code that may not be sent
        synchronized (closing) {
            closeReceived = true;
            closeReason = reason;
        }
        // answer a close we did not start, and end when both are written/read
        closeWith(WebSocketFrames.NORMAL_CLOSURE, "");
        maybeFinish();
    }

    // --- writing

    private void writeLoop() {
        try {
            while (true) {
                byte[] frame = queue.take();
                if (frame == STOP) return;
                ScheduledFuture<?> guard = timers.schedule(() -> finish("", false), limits.writeTimeoutMs, TimeUnit.MILLISECONDS);
                try {
                    out.write(frame);
                    out.flush();
                } finally {
                    guard.cancel(false);
                }
                queuedBytes.addAndGet(-frame.length);
                boolean wasClose;
                synchronized (closing) {
                    wasClose = frame == closeFrame;
                    if (wasClose) closeWritten = true;
                }
                if (wasClose) afterCloseWritten();
            }
        } catch (IOException error) {
            finish("", false);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            finish("", false);
        }
    }

    private void afterCloseWritten() {
        boolean abandon;
        synchronized (closing) {
            abandon = abandoned;
        }
        if (abandon) {
            finish("", true);
            return;
        }
        maybeFinish();
        // the other side's close may never come: give it a moment, then go
        timers.schedule(() -> finish(null, false), limits.closeGraceMs, TimeUnit.MILLISECONDS);
    }

    /** Both closes have gone by: the connection is over */
    private void maybeFinish() {
        synchronized (closing) {
            if (!(closeReceived && closeWritten)) return;
        }
        finish(null, false);
    }

    /** `reason` null: the one this connection settled on */
    private void finish(String reason, boolean violated) {
        if (!finished.compareAndSet(false, true)) return;
        String told;
        boolean broke;
        synchronized (closing) {
            told = reason == null || reason.isEmpty() ? closeReason : reason;
            broke = violated || violation;
        }
        try {
            socket.close();
        } catch (IOException ignored) {
            // already closed
        }
        queue.clear();
        queue.add(STOP);
        listener.onClose(told, broke);
    }
}
