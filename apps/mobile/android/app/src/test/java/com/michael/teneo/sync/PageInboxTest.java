package com.michael.teneo.sync;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.Test;

public class PageInboxTest {

    @Test
    public void anEventIsALetterTheConnectionASpaceAndWhatItCarries() {
        // inbox.test.ts reads these same strings
        assertEquals("o3 110.0.2.2:51820", PageInbox.opened(3, "10.0.2.2:51820", true));
        assertEquals("o4 0192.168.1.20", PageInbox.opened(4, "192.168.1.20", false));
        assertEquals("m12 {\"t\":\"ping\"} and spaces", PageInbox.message(12, "{\"t\":\"ping\"} and spaces"));
        assertEquals("c5 ", PageInbox.closed(5, ""));
        assertEquals("c5 the other device stopped", PageInbox.closed(5, "the other device stopped"));
    }

    @Test
    public void eventsAreTakenInTheOrderTheyCame() {
        PageInbox inbox = new PageInbox(1_000);
        inbox.add(PageInbox.opened(1, "a", true));
        inbox.put(PageInbox.message(1, "one"));
        inbox.put(PageInbox.message(1, "two"));
        inbox.add(PageInbox.closed(1, ""));
        assertEquals("o1 1a", inbox.take());
        assertEquals("m1 one", inbox.take());
        assertEquals("m1 two", inbox.take());
        assertEquals("c1 ", inbox.take());
        assertNull(inbox.take());
    }

    @Test
    public void thePageIsToldOnlyOnceItHasFoundTheInboxEmpty() {
        PageInbox inbox = new PageInbox(1_000);
        assertTrue("the first event tells it", inbox.put("m1 a"));
        assertFalse("it has been told already", inbox.put("m1 b"));
        assertEquals("m1 a", inbox.take());
        assertFalse("it is still taking", inbox.add("c1 "));
        assertEquals("m1 b", inbox.take());
        assertEquals("c1 ", inbox.take());
        assertNull(inbox.take());
        assertTrue("it found the inbox empty, so it is told again", inbox.put("m2 c"));
    }

    @Test
    public void aMessageWaitsWhileTooMuchIsQueuedAndOneAlwaysGetsThrough() throws Exception {
        PageInbox inbox = new PageInbox(10);
        // bigger than the limit, but nothing is waiting: it goes in at once
        inbox.put("m1 " + "x".repeat(20));
        AtomicBoolean queued = new AtomicBoolean();
        CountDownLatch done = new CountDownLatch(1);
        Thread reader = new Thread(() -> {
            inbox.put("m1 next");
            queued.set(true);
            done.countDown();
        });
        reader.start();
        assertFalse("waits while the page is behind", done.await(200, TimeUnit.MILLISECONDS));
        assertFalse(queued.get());
        // an end never waits, and comes after what was queued before it
        inbox.add("c1 ");
        inbox.take();
        assertTrue("goes in once the page has taken", done.await(2, TimeUnit.SECONDS));
        assertEquals("c1 ", inbox.take());
        assertEquals("m1 next", inbox.take());
    }

    @Test
    public void closingDropsWhatIsQueuedAndLetsGoOfAWaitingReader() throws Exception {
        PageInbox inbox = new PageInbox(10);
        inbox.put("m1 " + "x".repeat(20));
        AtomicBoolean told = new AtomicBoolean(true);
        CountDownLatch done = new CountDownLatch(1);
        Thread reader = new Thread(() -> {
            told.set(inbox.put("m1 late"));
            done.countDown();
        });
        reader.start();
        assertFalse(done.await(200, TimeUnit.MILLISECONDS));
        inbox.close();
        assertTrue("let go", done.await(2, TimeUnit.SECONDS));
        assertFalse("and dropped", told.get());
        assertNull(inbox.take());
        assertFalse(inbox.add("c1 "));
        assertNull(inbox.take());
    }

    @Test
    public void anInterruptedReaderGivesUpAndStaysInterrupted() throws Exception {
        PageInbox inbox = new PageInbox(10);
        inbox.put("m1 " + "x".repeat(20));
        AtomicBoolean told = new AtomicBoolean(true);
        AtomicBoolean interrupted = new AtomicBoolean();
        Thread reader = new Thread(() -> {
            told.set(inbox.put("m1 late"));
            interrupted.set(Thread.currentThread().isInterrupted());
        });
        reader.start();
        Thread.sleep(100);
        reader.interrupt();
        reader.join(2_000);
        assertFalse(told.get());
        assertTrue(interrupted.get());
        assertEquals("only what came before", "m1 " + "x".repeat(20), inbox.take());
        assertNull(inbox.take());
    }
}
