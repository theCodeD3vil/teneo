#import <Foundation/Foundation.h>
#import <xpc/xpc.h>
#include <CommonCrypto/CommonDigest.h>
#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <sys/select.h>
#include <sys/stat.h>
#include <sysexits.h>
#include <unistd.h>

#include "protocol.h"

static bool verifies(int fd, const char *expectedHash, const char *size) {
    char *end;
    const unsigned long long expectedSize = strtoull(size, &end, 10);
    struct stat st;
    if (*size == '\0' || *end != '\0' || strlen(expectedHash) != CC_SHA256_DIGEST_LENGTH * 2 ||
        fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || (uint64_t)st.st_size != expectedSize)
        return false;

    CC_SHA256_CTX hash;
    CC_SHA256_Init(&hash);
    unsigned char buffer[65536], digest[CC_SHA256_DIGEST_LENGTH];
    unsigned long long remaining = expectedSize;
    while (remaining > 0) {
        const ssize_t count = read(fd, buffer, MIN(sizeof(buffer), remaining));
        if (count <= 0) return false;
        CC_SHA256_Update(&hash, buffer, (CC_LONG)count);
        remaining -= (unsigned long long)count;
    }
    CC_SHA256_Final(digest, &hash);
    char hex[CC_SHA256_DIGEST_LENGTH * 2 + 1];
    for (size_t i = 0; i < sizeof(digest); i++) snprintf(hex + i * 2, 3, "%02x", digest[i]);
    return strcmp(hex, expectedHash) == 0 && lseek(fd, 0, SEEK_SET) == 0;
}

static int openVerified(const char *path, const char *expectedHash, const char *size) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC | O_NONBLOCK);
    if (fd < 0) return -1;
    if (!verifies(fd, expectedHash, size)) {
        close(fd);
        return -1;
    }
    return fd;
}

static xpc_object_t send(xpc_connection_t connection, xpc_object_t request, int seconds) {
    dispatch_semaphore_t done = dispatch_semaphore_create(0);
    __block xpc_object_t result = NULL;
    xpc_connection_send_message_with_reply(connection, request,
        dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^(xpc_object_t reply) {
            if (xpc_get_type(reply) == XPC_TYPE_DICTIONARY) result = reply;
            dispatch_semaphore_signal(done);
        });
    if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, seconds * NSEC_PER_SEC)))
        return NULL;
    return result;
}

static bool hasLabel(xpc_object_t reply, const char *label) {
    if (!reply) return false;
    const char *value = xpc_dictionary_get_string(reply, "label");
    return value && strcmp(value, label) == 0;
}

static bool parseDoubleArg(const char *arg, double *out) {
    if (!arg || *arg == '\0') return false;
    char *end = NULL;
    double value = strtod(arg, &end);
    if (!end || *end != '\0' || !isfinite(value)) return false;
    *out = value;
    return true;
}

// Read exact byte count from fd; returns 0 on clean EOF at offset 0, 1 on full read, -1 on error/short read.
static int readExact(int fd, unsigned char *dst, size_t len) {
    size_t offset = 0;
    while (offset < len) {
        ssize_t got = read(fd, dst + offset, len - offset);
        if (got == 0) return offset == 0 ? 0 : -1;
        if (got < 0) {
            if (errno == EINTR) continue;
            return -1;
        }
        offset += (size_t)got;
    }
    return 1;
}

static uint32_t readU32LE(const unsigned char b[4]) {
    return (uint32_t)b[0] | ((uint32_t)b[1] << 8) | ((uint32_t)b[2] << 16) | ((uint32_t)b[3] << 24);
}

// Reads one framed batch from stdin: [u32_le count] followed by count * ([u32_le len][len bytes]).
// Returns NULL on error; sets *cleanEof = true if stdin closed cleanly before the batch header.
static xpc_object_t readFramedBatch(int fd, uint32_t *outCount, bool *cleanEof) {
    *cleanEof = false;
    unsigned char hdr[4];
    int status = readExact(fd, hdr, sizeof(hdr));
    if (status == 0) {
        *cleanEof = true;
        return NULL;
    }
    if (status < 0) return NULL;

    uint32_t count = readU32LE(hdr);
    if (count == 0 || count > TENEO_AI_MAX_BATCH) return NULL;

    xpc_object_t texts = xpc_array_create(NULL, 0);
    unsigned char buf[TENEO_AI_MAX_BYTES];
    for (uint32_t i = 0; i < count; i++) {
        unsigned char lenBytes[4];
        if (readExact(fd, lenBytes, sizeof(lenBytes)) != 1) {
            memset_s(buf, sizeof(buf), 0, sizeof(buf));
            return NULL;
        }
        uint32_t byteLen = readU32LE(lenBytes);
        if (byteLen > TENEO_AI_MAX_BYTES) {
            memset_s(buf, sizeof(buf), 0, sizeof(buf));
            return NULL;
        }
        if (byteLen > 0 && readExact(fd, buf, byteLen) != 1) {
            memset_s(buf, sizeof(buf), 0, sizeof(buf));
            return NULL;
        }
        xpc_object_t item = xpc_data_create(buf, byteLen);
        xpc_array_append_value(texts, item);
    }
    memset_s(buf, sizeof(buf), 0, sizeof(buf));
    *outCount = count;
    return texts;
}

static bool extractBatchLabels(xpc_object_t reply, uint32_t expectedCount, const char **outLabels) {
    if (!reply) return false;
    xpc_object_t arr = xpc_dictionary_get_value(reply, "labels");
    if (!arr || xpc_get_type(arr) != XPC_TYPE_ARRAY) return false;
    if (xpc_array_get_count(arr) != (size_t)expectedCount) return false;
    for (uint32_t i = 0; i < expectedCount; i++) {
        const char *label = xpc_array_get_string(arr, i);
        if (!label) return false;
        if (strcmp(label, "possible_secret") == 0) {
            outLabels[i] = "possible_secret";
        } else if (strcmp(label, "no_signal") == 0) {
            outLabels[i] = "no_signal";
        } else {
            return false;
        }
    }
    return true;
}

static xpc_connection_t openAuthenticatedService(void) {
    xpc_connection_t connection = xpc_connection_create(TENEO_AI_SERVICE, NULL);
    xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
        (void)event;
    });
    const int requirement = xpc_connection_set_peer_code_signing_requirement(connection,
        "identifier \"" TENEO_AI_SERVICE "\" and entitlement[\"com.apple.security.app-sandbox\"] exists");
    xpc_connection_activate(connection);
    if (requirement != 0) {
        xpc_connection_cancel(connection);
        return NULL;
    }
    xpc_object_t handshake = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(handshake, "operation", "probe");
    // First launch of a signed build can wait for macOS policy assessment.
    if (!hasLabel(send(connection, handshake, 10), "isolated")) {
        xpc_connection_cancel(connection);
        return NULL;
    }
    return connection;
}

// Only the operation and model path travel in argv. Clipboard bytes arrive
// over stdin and are sent over private XPC, never as arguments or filenames.
int main(int argc, char **argv) {
    @autoreleasepool {
        if (argc < 2) return EX_USAGE;
        const char *op = argv[1];

        const bool probe = argc == 2 && strcmp(op, "probe") == 0;
        const bool preview = argc == 5 && strcmp(op, "preview") == 0;
        const bool secrets = argc == 5 && strcmp(op, "secrets") == 0;
        const bool verify = argc == 5 && strcmp(op, "verify") == 0;
        const bool verifyQ12 = argc == 8 && strcmp(op, "verify-q12") == 0;
        const bool classifyQ12 = argc == 9 && strcmp(op, "classify-q12") == 0;
        const bool serveQ12 = argc == 10 && strcmp(op, "serve-q12") == 0;

        if (!probe && !preview && !secrets && !verify && !verifyQ12 && !classifyQ12 && !serveQ12) {
            return EX_USAGE;
        }

        if (verify) {
            int fd = openVerified(argv[2], argv[3], argv[4]);
            if (fd < 0) return EX_NOINPUT;
            close(fd);
            puts("verified");
            return EX_OK;
        }

        if (verifyQ12) {
            int wFd = openVerified(argv[2], argv[3], argv[4]);
            if (wFd < 0) return EX_NOINPUT;
            int tFd = openVerified(argv[5], argv[6], argv[7]);
            close(wFd);
            if (tFd < 0) return EX_NOINPUT;
            close(tFd);
            puts("verified");
            return EX_OK;
        }

        if (probe) {
            xpc_connection_t connection = openAuthenticatedService();
            if (!connection) return EX_UNAVAILABLE;
            xpc_connection_cancel(connection);
            puts("isolated");
            return EX_OK;
        }

        if (preview || secrets) {
            int fd = openVerified(argv[2], argv[3], argv[4]);
            if (fd < 0) return EX_NOINPUT;

            xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_string(request, "operation", op);
            xpc_dictionary_set_fd(request, "model", fd);
            close(fd);

            xpc_connection_t connection = openAuthenticatedService();
            if (!connection) return EX_UNAVAILABLE;

            char input[TENEO_AI_MAX_BYTES + 1];
            size_t length = fread(input, 1, sizeof(input), stdin);
            const bool valid = !ferror(stdin) && length > 0 && length <= TENEO_AI_MAX_BYTES;
            if (valid) xpc_dictionary_set_data(request, "text", input, length);
            memset_s(input, sizeof(input), 0, sizeof(input));
            if (!valid) {
                xpc_connection_cancel(connection);
                return EX_DATAERR;
            }

            xpc_object_t reply = send(connection, request, 20);
            const char *answer = NULL;
            if (preview && hasLabel(reply, "stack_trace")) answer = "stack_trace";
            if (preview && hasLabel(reply, "other")) answer = "other";
            if (secrets && hasLabel(reply, "possible_secret")) answer = "possible_secret";
            if (secrets && hasLabel(reply, "no_signal")) answer = "no_signal";

            xpc_connection_cancel(connection);
            if (!answer) return EX_UNAVAILABLE;
            puts(answer);
            return EX_OK;
        }

        if (classifyQ12) {
            double cutoff = 0.0;
            if (!parseDoubleArg(argv[8], &cutoff)) return EX_USAGE;

            int wFd = openVerified(argv[2], argv[3], argv[4]);
            if (wFd < 0) return EX_NOINPUT;
            int tFd = openVerified(argv[5], argv[6], argv[7]);
            if (tFd < 0) {
                close(wFd);
                return EX_NOINPUT;
            }

            xpc_connection_t connection = openAuthenticatedService();
            if (!connection) {
                close(wFd);
                close(tFd);
                return EX_UNAVAILABLE;
            }

            uint32_t count = 0;
            bool cleanEof = false;
            xpc_object_t texts = readFramedBatch(STDIN_FILENO, &count, &cleanEof);
            unsigned char extra = 0;
            if (!texts || read(STDIN_FILENO, &extra, 1) != 0) {
                close(wFd);
                close(tFd);
                xpc_connection_cancel(connection);
                return EX_DATAERR;
            }

            xpc_object_t request = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_string(request, "operation", "classify-q12");
            xpc_dictionary_set_fd(request, "model", wFd);
            xpc_dictionary_set_fd(request, "tokenizer", tFd);
            xpc_dictionary_set_double(request, "cutoff", cutoff);
            xpc_dictionary_set_value(request, "texts", texts);
            close(wFd);
            close(tFd);

            xpc_object_t reply = send(connection, request, 15);
            const char *labels[TENEO_AI_MAX_BATCH];
            const bool ok = extractBatchLabels(reply, count, labels);
            xpc_connection_cancel(connection);
            if (!ok) return EX_UNAVAILABLE;

            for (uint32_t i = 0; i < count; i++) {
                puts(labels[i]);
            }
            return EX_OK;
        }

        if (serveQ12) {
            double cutoff = 0.0;
            double idleSeconds = 0.0;
            if (!parseDoubleArg(argv[8], &cutoff) || !parseDoubleArg(argv[9], &idleSeconds) ||
                idleSeconds <= 0.0 || idleSeconds > 60.0) {
                return EX_USAGE;
            }

            int wFd = openVerified(argv[2], argv[3], argv[4]);
            if (wFd < 0) return EX_NOINPUT;
            int tFd = openVerified(argv[5], argv[6], argv[7]);
            if (tFd < 0) {
                close(wFd);
                return EX_NOINPUT;
            }

            xpc_connection_t connection = openAuthenticatedService();
            if (!connection) {
                close(wFd);
                close(tFd);
                return EX_UNAVAILABLE;
            }

            xpc_object_t initReq = xpc_dictionary_create(NULL, NULL, 0);
            xpc_dictionary_set_string(initReq, "operation", "init-q12");
            xpc_dictionary_set_fd(initReq, "model", wFd);
            xpc_dictionary_set_fd(initReq, "tokenizer", tFd);
            close(wFd);
            close(tFd);

            if (!hasLabel(send(connection, initReq, 15), "ready")) {
                xpc_connection_cancel(connection);
                return EX_UNAVAILABLE;
            }

            puts("ready");
            fflush(stdout);

            for (;;) {
                fd_set rfds;
                FD_ZERO(&rfds);
                FD_SET(STDIN_FILENO, &rfds);
                struct timeval tv;
                tv.tv_sec = (time_t)idleSeconds;
                tv.tv_usec = (suseconds_t)((idleSeconds - (double)tv.tv_sec) * 1000000.0);
                int ready = select(STDIN_FILENO + 1, &rfds, NULL, NULL, &tv);
                if (ready == 0) break;
                if (ready < 0) {
                    if (errno == EINTR) continue;
                    xpc_connection_cancel(connection);
                    return EX_IOERR;
                }

                uint32_t count = 0;
                bool cleanEof = false;
                xpc_object_t texts = readFramedBatch(STDIN_FILENO, &count, &cleanEof);
                if (cleanEof) break;
                if (!texts) {
                    xpc_connection_cancel(connection);
                    return EX_DATAERR;
                }

                xpc_object_t batchReq = xpc_dictionary_create(NULL, NULL, 0);
                xpc_dictionary_set_string(batchReq, "operation", "batch-q12");
                xpc_dictionary_set_double(batchReq, "cutoff", cutoff);
                xpc_dictionary_set_value(batchReq, "texts", texts);

                xpc_object_t reply = send(connection, batchReq, 15);
                const char *labels[TENEO_AI_MAX_BATCH];
                if (!extractBatchLabels(reply, count, labels)) {
                    xpc_connection_cancel(connection);
                    return EX_UNAVAILABLE;
                }

                fprintf(stdout, "ok %u\n", count);
                for (uint32_t i = 0; i < count; i++) {
                    fputs(labels[i], stdout);
                    fputc('\n', stdout);
                }
                fflush(stdout);
            }

            xpc_connection_cancel(connection);
            return EX_OK;
        }

        return EX_USAGE;
    }
}
