package com.michael.teneo.sync;

import java.util.ArrayDeque;

/**
 * What the network has for the sync page: connections opening, their messages
 * and their ends, in the order they happened. The page takes them itself
 * (TeneoNative.nextEvent) on the web view's bridge thread. Run as script
 * instead, each was quoted, handed over on the main thread and parsed as
 * source by the page, and a piece of an image is a message of a third of a
 * megabyte.
 *
 * The page is told there is something to take only when it last found the
 * inbox empty, so it must take until it does (inbox.ts).
 *
 * An event is one string: a letter for what happened, the connection's
 * number, a space, then
 *   o: 1 if this phone dialed or 0 if the other device did, then the address
 *   m: the message
 *   c: why it closed, which may be nothing
 */
final class PageInbox {

    /**
     * Text queued and not yet taken. Past this, a socket's reading thread
     * waits in put, so a device that sends faster than the page takes is
     * slowed by its own connection instead of filling memory. One message
     * always gets through, whatever its size.
     */
    private final long maxWaitingChars;

    private final ArrayDeque<String> events = new ArrayDeque<>();
    private long waitingChars;
    /** The page has been told to take, and hasn't found the inbox empty since */
    private boolean pageTold;
    private boolean closed;

    PageInbox(long maxWaitingChars) {
        this.maxWaitingChars = maxWaitingChars;
    }

    static String opened(int connection, String address, boolean initiator) {
        return "o" + connection + " " + (initiator ? "1" : "0") + address;
    }

    static String message(int connection, String text) {
        return "m" + connection + " " + text;
    }

    static String closed(int connection, String reason) {
        return "c" + connection + " " + reason;
    }

    /**
     * Queue a message, first waiting while too much is queued already. True
     * when the page must be told to take it. Called on a socket's reading
     * thread; a message that comes once the inbox is closed is dropped.
     */
    synchronized boolean put(String event) {
        while (waitingChars > maxWaitingChars && !closed) {
            try {
                wait(1_000);
            } catch (InterruptedException stopping) {
                Thread.currentThread().interrupt();
                return false;
            }
        }
        return add(event);
    }

    /** Queue an opening or an end, which never waits. True when the page must be told. */
    synchronized boolean add(String event) {
        if (closed) return false;
        events.addLast(event);
        waitingChars += event.length();
        if (pageTold) return false;
        pageTold = true;
        return true;
    }

    /** The next event, or null when there is none: the page is told of the next one to come */
    synchronized String take() {
        String event = closed ? null : events.pollFirst();
        if (event == null) {
            pageTold = false;
            return null;
        }
        waitingChars -= event.length();
        notifyAll();
        return event;
    }

    /** Drop what is queued and let go of every thread waiting to queue more */
    synchronized void close() {
        closed = true;
        events.clear();
        waitingChars = 0;
        notifyAll();
    }
}
