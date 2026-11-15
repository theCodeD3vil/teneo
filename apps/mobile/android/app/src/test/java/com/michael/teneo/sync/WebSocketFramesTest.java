package com.michael.teneo.sync;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.io.ByteArrayInputStream;
import java.io.EOFException;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import org.junit.Test;

public class WebSocketFramesTest {

    private static WebSocketFrames.Frame read(byte[] bytes, boolean expectMasked, long max) throws IOException {
        return new WebSocketFrames.Reader(new ByteArrayInputStream(bytes), expectMasked, max).read();
    }

    private static int codeOf(ProtocolViolation violation) {
        return violation.closeCode;
    }

    private static byte[] bytes(int... values) {
        byte[] out = new byte[values.length];
        for (int i = 0; i < values.length; i++) out[i] = (byte) values[i];
        return out;
    }

    @Test
    public void everyLengthSizeRoundTripsMaskedAndNot() throws IOException {
        // 7-bit, 16-bit and 64-bit length forms, and the edges between them
        for (int length : new int[] { 0, 1, 125, 126, 127, 65_535, 65_536, 300_000 }) {
            byte[] payload = new byte[length];
            for (int i = 0; i < length; i++) payload[i] = (byte) (i * 31);
            for (boolean masked : new boolean[] { false, true }) {
                WebSocketFrames.Frame frame = read(WebSocketFrames.encode(WebSocketFrames.TEXT, payload, masked), masked, 1_000_000);
                assertEquals(WebSocketFrames.TEXT, frame.opcode);
                assertTrue(frame.fin);
                assertArrayEquals("length " + length, payload, frame.payload);
            }
        }
    }

    @Test
    public void aMaskedFrameDoesNotCarryItsPayloadInTheClear() {
        byte[] payload = "secret".getBytes(StandardCharsets.UTF_8);
        byte[] frame = WebSocketFrames.encode(WebSocketFrames.TEXT, payload, true);
        assertEquals((byte) 0x80 | 6, frame[1]);
        assertFalse(Arrays.equals(payload, Arrays.copyOfRange(frame, 6, 12)));
    }

    @Test
    public void theRfcExampleOfAMaskedHelloIsRead() throws IOException {
        // RFC 6455, section 5.7: a single-frame masked text message "Hello"
        byte[] frame = bytes(0x81, 0x85, 0x37, 0xfa, 0x21, 0x3d, 0x7f, 0x9f, 0x4d, 0x51, 0x58);
        assertEquals("Hello", new String(read(frame, true, 100).payload, StandardCharsets.UTF_8));
    }

    @Test
    public void theWrongMaskingForTheRoleIsAViolation() {
        byte[] unmasked = WebSocketFrames.encode(WebSocketFrames.TEXT, new byte[3], false);
        byte[] masked = WebSocketFrames.encode(WebSocketFrames.TEXT, new byte[3], true);
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(unmasked, true, 100))));
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(masked, false, 100))));
    }

    @Test
    public void reservedBitsAndUnknownOpcodesAreViolations() {
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0xC1, 0x00), false, 100)))); // RSV1: compression
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x83, 0x00), false, 100))));
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x8B, 0x00), false, 100))));
    }

    @Test
    public void controlFramesMustBeShortAndWhole() {
        // a ping that is fragmented, and one with a 126-byte payload
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x09, 0x00), false, 1000))));
        byte[] big = WebSocketFrames.encode(WebSocketFrames.PING, new byte[126], false);
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(big, false, 1000))));
    }

    @Test
    public void aLengthOverTheLimitIsRefusedBeforeAnyPayloadIsRead() {
        // 16-bit form claiming 1000 bytes, with none following, against a limit of 100
        assertEquals(1009, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x81, 126, 0x03, 0xE8), false, 100))));
        // 64-bit form claiming 2^40
        assertEquals(1009, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x81, 127, 0, 0, 1, 0, 0, 0, 0, 0), false, 100))));
        // 64-bit form with the top bit set
        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> read(bytes(0x81, 127, 0x80, 0, 0, 0, 0, 0, 0, 0), false, 100))));
    }

    @Test
    public void aTruncatedFrameIsAnEndOfStreamNotAViolation() {
        byte[] whole = WebSocketFrames.encode(WebSocketFrames.TEXT, "hello".getBytes(StandardCharsets.UTF_8), false);
        for (int cut = 0; cut < whole.length; cut++) {
            byte[] part = Arrays.copyOf(whole, cut);
            assertThrows("cut at " + cut, EOFException.class, () -> read(part, false, 100));
        }
    }

    @Test
    public void aClaimedLengthDoesNotAllocateUntilDataArrives() {
        // claims 8 MiB, sends 10 bytes: must fail with an end of stream, quickly and cheaply
        byte[] head = bytes(0x81, 127, 0, 0, 0, 0, 0, 0x80, 0, 0);
        byte[] frame = Arrays.copyOf(head, head.length + 10);
        assertThrows(EOFException.class, () -> read(frame, false, 8L * 1024 * 1024));
    }

    @Test
    public void fragmentsJoinIntoOneMessage() throws IOException {
        WebSocketFrames.Assembler assembler = new WebSocketFrames.Assembler(100);
        byte[] euro = "€".getBytes(StandardCharsets.UTF_8); // three bytes, split across fragments
        assertNull(assembler.add(new WebSocketFrames.Frame(WebSocketFrames.TEXT, false, Arrays.copyOf(euro, 1))));
        assertNull(assembler.add(new WebSocketFrames.Frame(WebSocketFrames.CONTINUATION, false, Arrays.copyOfRange(euro, 1, 2))));
        assertEquals("€", assembler.add(new WebSocketFrames.Frame(WebSocketFrames.CONTINUATION, true, Arrays.copyOfRange(euro, 2, 3))));
        // and the next message starts clean
        assertEquals("next", assembler.add(new WebSocketFrames.Frame(WebSocketFrames.TEXT, true, "next".getBytes(StandardCharsets.UTF_8))));
    }

    @Test
    public void fragmentRulesAreEnforced() {
        WebSocketFrames.Frame start = new WebSocketFrames.Frame(WebSocketFrames.TEXT, false, new byte[1]);
        WebSocketFrames.Frame more = new WebSocketFrames.Frame(WebSocketFrames.CONTINUATION, true, new byte[1]);

        assertEquals(1002, codeOf(assertThrows(ProtocolViolation.class, () -> new WebSocketFrames.Assembler(100).add(more))));
        WebSocketFrames.Assembler inside = new WebSocketFrames.Assembler(100);
        assertThrows(ProtocolViolation.class, () -> {
            inside.add(start);
            inside.add(start); // a new message inside an unfinished one
        });
        assertEquals(1003, codeOf(assertThrows(ProtocolViolation.class, () -> new WebSocketFrames.Assembler(100).add(new WebSocketFrames.Frame(WebSocketFrames.BINARY, true, new byte[1])))));
    }

    @Test
    public void aMessageOverTheLimitInFragmentsIsRefused() {
        WebSocketFrames.Assembler assembler = new WebSocketFrames.Assembler(10);
        assertEquals(
            1009,
            codeOf(
                assertThrows(ProtocolViolation.class, () -> {
                    assembler.add(new WebSocketFrames.Frame(WebSocketFrames.TEXT, false, new byte[6]));
                    assembler.add(new WebSocketFrames.Frame(WebSocketFrames.CONTINUATION, true, new byte[6]));
                })
            )
        );
    }

    @Test
    public void textThatIsNotUtf8IsRefused() {
        for (byte[] bad : new byte[][] { bytes(0xFF), bytes(0xC0, 0x80), bytes(0xED, 0xA0, 0x80), bytes(0xE2, 0x82) }) {
            assertEquals(1007, codeOf(assertThrows(ProtocolViolation.class, () -> WebSocketFrames.decodeText(bad))));
        }
    }

    @Test
    public void closeFramesCarryACodeAndAReason() throws IOException {
        byte[] payload = WebSocketFrames.closePayload(1000, "auth");
        assertEquals(1000, WebSocketFrames.closeCode(payload));
        assertEquals("auth", WebSocketFrames.closeReason(payload));
        assertEquals(1005, WebSocketFrames.closeCode(new byte[0]));
        assertEquals("", WebSocketFrames.closeReason(new byte[0]));
    }

    @Test
    public void aLongReasonIsCutBetweenCharactersNotInOne() throws IOException {
        byte[] payload = WebSocketFrames.closePayload(1000, "é".repeat(100));
        assertTrue(payload.length <= WebSocketFrames.MAX_CONTROL_PAYLOAD);
        // the reader must still find valid UTF-8 in it
        assertTrue(WebSocketFrames.closeReason(payload).matches("é+"));
    }

    @Test
    public void closeCodesThatMustNotBeSentAreRefused() {
        for (int code : new int[] { 0, 999, 1004, 1005, 1006, 1012, 1015, 2999, 5000 }) {
            byte[] payload = bytes(code >> 8, code & 0xFF);
            assertThrows("code " + code, ProtocolViolation.class, () -> WebSocketFrames.closeCode(payload));
        }
        assertThrows(ProtocolViolation.class, () -> WebSocketFrames.closeCode(bytes(0x03)));
    }
}
