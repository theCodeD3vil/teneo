package com.michael.teneo.sync;

/**
 * Every size, time and count the sync network keeps to, in one place. The
 * defaults are the ones the Mac uses where the Mac has one (lan-transport.ts,
 * packages/sync's protocol.ts); tests make them small.
 */
final class SyncLimits {

    /** The ports a device listens on, the first free one taken: ports.ts */
    static final int[] PORTS = { 47823, 47824, 47825, 47826, 47827 };

    /** A message the protocol allows is at most this long (maxMessageLength) */
    long maxMessageBytes = 8L * 1024 * 1024;
    /** A client has this long to send its upgrade request */
    long requestTimeoutMs = 10_000;
    /** A request head longer than this is refused */
    int maxRequestBytes = 8 * 1024;
    /** A connection that sends nothing for this long is dropped. The engine
     *  pings every 15 seconds and gives up after 45 of silence, so a live one
     *  never gets near this */
    long idleTimeoutMs = 60_000;
    /** One write that takes this long means the other side stopped reading */
    long writeTimeoutMs = 30_000;
    /** After a close is sent, how long to wait for the other side's */
    long closeGraceMs = 2_000;
    /** Messages waiting to be written, per connection */
    long maxQueuedBytes = 16L * 1024 * 1024;
    /** Connections from others at once, counting those still in their upgrade */
    int maxInbound = 8;
    /** Dialing a device gives up after this */
    int connectTimeoutMs = 5_000;
    /** An address whose handshakes fail this often in the window is refused */
    int failureCount = 5;
    long failureWindowMs = 60_000;
    /** A connection that fails this soon after opening failed its handshake */
    long handshakeWindowMs = 10_000;

    static SyncLimits defaults() {
        return new SyncLimits();
    }
}
