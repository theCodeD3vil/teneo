package com.michael.teneo.sync;

import java.io.IOException;

/** The other side broke the WebSocket rules; `closeCode` is what to tell it (RFC 6455, 7.4) */
final class ProtocolViolation extends IOException {

    static final int PROTOCOL_ERROR = 1002;
    static final int UNSUPPORTED_DATA = 1003;
    static final int INVALID_PAYLOAD = 1007;
    static final int TOO_BIG = 1009;

    final int closeCode;

    ProtocolViolation(int closeCode, String message) {
        super(message);
        this.closeCode = closeCode;
    }
}
