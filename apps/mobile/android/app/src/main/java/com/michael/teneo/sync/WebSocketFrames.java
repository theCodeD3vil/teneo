package com.michael.teneo.sync;

import java.io.ByteArrayOutputStream;
import java.io.EOFException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.Arrays;

/**
 * WebSocket frames (RFC 6455, section 5), read and written by either end.
 * What is accepted is strict: reserved bits, unknown opcodes, the wrong
 * masking for the sender's role, oversized or fragmented control frames and
 * lengths over the limit all end the connection. No extensions are spoken.
 */
final class WebSocketFrames {

    static final int CONTINUATION = 0x0;
    static final int TEXT = 0x1;
    static final int BINARY = 0x2;
    static final int CLOSE = 0x8;
    static final int PING = 0x9;
    static final int PONG = 0xA;

    static final int MAX_CONTROL_PAYLOAD = 125;
    /** The close code that means nothing was said: never sent, only reported */
    static final int NORMAL_CLOSURE = 1000;

    private static final SecureRandom RANDOM = new SecureRandom();

    private WebSocketFrames() {}

    static final class Frame {

        final int opcode;
        final boolean fin;
        final byte[] payload;

        Frame(int opcode, boolean fin, byte[] payload) {
            this.opcode = opcode;
            this.fin = fin;
            this.payload = payload;
        }

        boolean isControl() {
            return opcode >= 0x8;
        }
    }

    /** One whole frame, ready to write. Clients mask, servers don't. */
    static byte[] encode(int opcode, byte[] payload, boolean mask) {
        int length = payload.length;
        int lengthBytes = length < 126 ? 0 : length <= 0xFFFF ? 2 : 8;
        byte[] frame = new byte[2 + lengthBytes + (mask ? 4 : 0) + length];
        frame[0] = (byte) (0x80 | opcode);
        int at = 1;
        int maskBit = mask ? 0x80 : 0;
        if (lengthBytes == 0) {
            frame[at++] = (byte) (maskBit | length);
        } else if (lengthBytes == 2) {
            frame[at++] = (byte) (maskBit | 126);
            frame[at++] = (byte) (length >>> 8);
            frame[at++] = (byte) length;
        } else {
            frame[at++] = (byte) (maskBit | 127);
            // the high four bytes of a 64-bit length are zero: a payload is under 2 GiB
            at += 4;
            frame[at++] = (byte) (length >>> 24);
            frame[at++] = (byte) (length >>> 16);
            frame[at++] = (byte) (length >>> 8);
            frame[at++] = (byte) length;
        }
        if (mask) {
            byte[] key = new byte[4];
            RANDOM.nextBytes(key);
            System.arraycopy(key, 0, frame, at, 4);
            at += 4;
            for (int i = 0; i < length; i++) frame[at + i] = (byte) (payload[i] ^ key[i & 3]);
        } else {
            System.arraycopy(payload, 0, frame, at, length);
        }
        return frame;
    }

    /** The payload of a close frame: a code and a reason of at most 123 bytes */
    static byte[] closePayload(int code, String reason) {
        byte[] text = reason == null ? new byte[0] : reason.getBytes(StandardCharsets.UTF_8);
        int length = Math.min(text.length, MAX_CONTROL_PAYLOAD - 2);
        // never cut a multi-byte character in half: the reader checks for valid UTF-8
        while (length > 0 && length < text.length && (text[length] & 0xC0) == 0x80) length--;
        byte[] payload = new byte[2 + length];
        payload[0] = (byte) (code >>> 8);
        payload[1] = (byte) code;
        System.arraycopy(text, 0, payload, 2, length);
        return payload;
    }

    /** A close frame's code, or 1005 ("none") when it carries no payload */
    static int closeCode(byte[] payload) throws ProtocolViolation {
        if (payload.length == 0) return 1005;
        if (payload.length == 1) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "close frame of one byte");
        int code = ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF);
        boolean sendable = (code >= 1000 && code <= 1003) || (code >= 1007 && code <= 1011) || (code >= 3000 && code <= 4999);
        if (!sendable) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "close code " + code);
        return code;
    }

    /** A close frame's reason, which has to be UTF-8 like any text */
    static String closeReason(byte[] payload) throws ProtocolViolation {
        return payload.length <= 2 ? "" : decodeText(Arrays.copyOfRange(payload, 2, payload.length));
    }

    /** Text from a payload, or a violation when it is not valid UTF-8 */
    static String decodeText(byte[] bytes) throws ProtocolViolation {
        try {
            return StandardCharsets.UTF_8
                .newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString();
        } catch (CharacterCodingException error) {
            throw new ProtocolViolation(ProtocolViolation.INVALID_PAYLOAD, "text is not UTF-8");
        }
    }

    /** Reads frames off a stream, for the end that expects `expectMasked` */
    static final class Reader {

        private final InputStream in;
        private final boolean expectMasked;
        private final long maxPayload;

        /** `expectMasked`: true when reading what a client sends */
        Reader(InputStream in, boolean expectMasked, long maxPayload) {
            this.in = in;
            this.expectMasked = expectMasked;
            this.maxPayload = maxPayload;
        }

        /** The next frame. Blocks; an end of stream is an EOFException. */
        Frame read() throws IOException {
            int first = readByte();
            int second = readByte();
            if ((first & 0x70) != 0) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "reserved bits set");
            boolean fin = (first & 0x80) != 0;
            int opcode = first & 0x0F;
            boolean known = opcode <= BINARY || (opcode >= CLOSE && opcode <= PONG);
            if (!known) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "unknown opcode " + opcode);

            boolean masked = (second & 0x80) != 0;
            if (masked != expectMasked) {
                throw new ProtocolViolation(
                    ProtocolViolation.PROTOCOL_ERROR,
                    masked ? "masked frame from a server" : "unmasked frame from a client"
                );
            }

            long length = second & 0x7F;
            if (length == 126) {
                length = (readByte() << 8) | readByte();
            } else if (length == 127) {
                length = 0;
                for (int i = 0; i < 8; i++) length = (length << 8) | readByte();
                if (length < 0) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "length with the top bit set");
            }

            boolean control = opcode >= CLOSE;
            if (control && (!fin || length > MAX_CONTROL_PAYLOAD)) {
                throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "bad control frame");
            }
            if (length > maxPayload) throw new ProtocolViolation(ProtocolViolation.TOO_BIG, "frame too big");

            byte[] key = masked ? readExactly(4) : null;
            byte[] payload = readExactly((int) length);
            if (key != null) for (int i = 0; i < payload.length; i++) payload[i] ^= key[i & 3];
            return new Frame(opcode, fin, payload);
        }

        private int readByte() throws IOException {
            int value = in.read();
            if (value < 0) throw new EOFException();
            return value;
        }

        /** The payload grows as bytes arrive, so a claimed length that is never
         *  followed by data costs nothing */
        private byte[] readExactly(int length) throws IOException {
            byte[] buffer = new byte[Math.min(length, 64 * 1024)];
            int have = 0;
            while (have < length) {
                if (have == buffer.length) buffer = Arrays.copyOf(buffer, (int) Math.min((long) length, buffer.length * 2L));
                int read = in.read(buffer, have, buffer.length - have);
                if (read < 0) throw new EOFException();
                have += read;
            }
            return buffer;
        }
    }

    /** Joins the fragments of one message and checks the rules for them */
    static final class Assembler {

        private final long maxBytes;
        private final ByteArrayOutputStream parts = new ByteArrayOutputStream();
        private boolean assembling;

        Assembler(long maxBytes) {
            this.maxBytes = maxBytes;
        }

        /** The finished text message, or null while more fragments are due */
        String add(Frame frame) throws IOException {
            if (frame.opcode == BINARY) throw new ProtocolViolation(ProtocolViolation.UNSUPPORTED_DATA, "binary messages are not spoken here");
            if (frame.opcode == TEXT) {
                if (assembling) throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "a new message began inside another");
                assembling = true;
            } else if (!assembling) {
                throw new ProtocolViolation(ProtocolViolation.PROTOCOL_ERROR, "a continuation with nothing to continue");
            }
            if (parts.size() + (long) frame.payload.length > maxBytes) {
                throw new ProtocolViolation(ProtocolViolation.TOO_BIG, "message too big");
            }
            parts.write(frame.payload, 0, frame.payload.length);
            if (!frame.fin) return null;
            byte[] whole = parts.toByteArray();
            parts.reset();
            assembling = false;
            return decodeText(whole);
        }
    }
}
