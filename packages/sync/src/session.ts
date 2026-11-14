// A Session turns a Channel into an authenticated, encrypted frame pipe.
//
//   1. both send hello { v, deviceId, nonce }
//   2. both send proof = HMAC(authKey, role | both nonces | both ids); a wrong
//      proof means the other device does not hold the vault key
//   3. every later message is AES-GCM of one JSON frame, keyed per direction
//      from the authKey and both nonces, with the frame's number as nonce
import type { Channel } from "./channel";
import {
  type Bytes,
  fromBase64,
  fromHex,
  fromUtf8,
  hkdf,
  hmacSha256,
  importAesKey,
  randomBytes,
  seal,
  timingSafeEqual,
  toBase64,
  toHex,
  unseal,
  utf8,
} from "./crypto";
import {
  type ChangesFrame,
  type Frame,
  type StateFrame,
  handshakeMs,
  heartbeat,
  maxMessageLength,
  parseFrame,
  parseHandshake,
  protocolVersion,
} from "./protocol";

export type SyncErrorCode =
  | "version" // the other device speaks another protocol version
  | "auth" // the other device does not hold the vault key
  | "protocol" // a message was malformed, altered, repeated or out of order
  | "timeout" // the other device went silent
  | "closed" // the connection ended
  | "failed"; // something on this device went wrong

export class SyncError extends Error {
  readonly code: SyncErrorCode;

  constructor(code: SyncErrorCode, message: string) {
    super(message);
    this.name = "SyncError";
    this.code = code;
  }
}

// A device that closes because of a protocol problem says which. Taking its
// word means both sides show the same cause, even when this side's own check
// had not run yet.
const statedReasons: SyncErrorCode[] = [
  "auth",
  "version",
  "protocol",
  "timeout",
];

function closedBy(reason: string | undefined): SyncError {
  const stated = statedReasons.find((code) => code === reason);
  return stated
    ? new SyncError(stated, `The other device ended the connection: ${stated}`)
    : new SyncError(
        "closed",
        reason ? `Connection closed: ${reason}` : "Connection closed",
      );
}

/** Runs a task every so often. Injected so tests don't wait 15 seconds. */
export interface Scheduler {
  every(milliseconds: number, task: () => void): () => void;
}

export const realScheduler: Scheduler = {
  every(milliseconds, task) {
    const handle = setInterval(task, milliseconds);
    return () => clearInterval(handle);
  },
};

export interface SessionOptions {
  deviceId: string;
  authKey: Bytes;
  scheduler?: Scheduler;
  now?: () => number;
  /** How long the handshake may take. */
  handshakeMs?: number;
}

export type FrameHandler = (
  frame: StateFrame | ChangesFrame,
) => Promise<void> | void;

type Phase = "hello" | "proof" | "open" | "closed";

export class Session {
  /** The other device's id, known once its hello arrived. */
  peerId = "";
  readonly initiator: boolean;
  readonly remoteAddress: string | undefined;
  /** Settles when the connection ends: with why, or null when this side closed it. */
  readonly closed: Promise<SyncError | null>;

  private readonly channel: Channel;
  private readonly options: SessionOptions;
  private readonly scheduler: Scheduler;
  private readonly now: () => number;
  private readonly nonce = toHex(randomBytes(16));
  private readonly opened: Promise<Session>;
  private readonly handler: Promise<FrameHandler>;
  private resolveOpened!: (session: Session) => void;
  private rejectOpened!: (error: SyncError) => void;
  private resolveClosed!: (error: SyncError | null) => void;
  private resolveHandler!: (handler: FrameHandler) => void;

  private phase: Phase = "hello";
  private peerProof: Bytes | null = null;
  private sendKey: CryptoKey | null = null;
  private receiveKey: CryptoKey | null = null;
  private sentCount = 0;
  private receivedCount = 0;
  private lastHeard = 0;
  private working = 0;
  private inbox: Promise<void> = Promise.resolve();
  private outbox: Promise<void> = Promise.resolve();
  private stopHeartbeat: (() => void) | null = null;

  private constructor(channel: Channel, options: SessionOptions) {
    this.channel = channel;
    this.options = options;
    this.initiator = channel.initiator;
    this.remoteAddress = channel.remoteAddress;
    this.scheduler = options.scheduler ?? realScheduler;
    this.now = options.now ?? Date.now;
    this.opened = new Promise((resolve, reject) => {
      this.resolveOpened = resolve;
      this.rejectOpened = reject;
    });
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    this.handler = new Promise((resolve) => {
      this.resolveHandler = resolve;
    });

    channel.onMessage((message) => this.receive(message));
    channel.onClose((reason) => this.end(closedBy(reason)));
    channel.send(
      JSON.stringify({
        t: "hello",
        v: protocolVersion,
        deviceId: options.deviceId,
        nonce: this.nonce,
      }),
    );
  }

  /** Run the handshake. Rejects with a SyncError, after closing the channel. */
  static open(channel: Channel, options: SessionOptions): Promise<Session> {
    const session = new Session(channel, options);
    const timer = setTimeout(
      () =>
        session.end(
          new SyncError(
            "timeout",
            "The other device did not finish connecting",
          ),
        ),
      options.handshakeMs ?? handshakeMs,
    );
    return session.opened.finally(() => clearTimeout(timer));
  }

  /** Frames that arrive before this is called wait for it. */
  onFrame(handler: FrameHandler): void {
    this.resolveHandler(handler);
  }

  /** Rejects when the connection is closed, or when the send fails. */
  send(frame: Frame): Promise<void> {
    this.working += 1;
    const sent = this.outbox
      .then(async () => {
        if (this.phase !== "open")
          throw new SyncError("closed", "Connection closed");
        // the counter is taken here, in send order, not when send() was called
        const counter = this.sentCount++;
        const sealed = await seal(
          this.sendKey!,
          counter,
          utf8(JSON.stringify(frame)),
        );
        this.channel.send(toBase64(sealed));
      })
      .finally(() => {
        this.working -= 1;
      });
    this.outbox = sent.catch(() => undefined);
    return sent;
  }

  close(): void {
    this.end(null);
  }

  /** Nothing is being read or sent. For tests that wait for a quiet network. */
  idle(): boolean {
    return this.working === 0;
  }

  // --- receiving: one message at a time, in order

  private receive(message: string): void {
    this.working += 1;
    this.inbox = this.inbox
      .then(() => this.handle(message))
      .catch((error: unknown) =>
        this.end(
          error instanceof SyncError
            ? error
            : new SyncError(
                "failed",
                `Handling a message failed: ${String(error)}`,
              ),
        ),
      )
      .finally(() => {
        this.working -= 1;
      });
  }

  private async handle(message: string): Promise<void> {
    if (this.phase === "closed") return;
    if (message.length > maxMessageLength) {
      throw new SyncError("protocol", "A message was too large");
    }
    if (this.phase === "hello") return this.handleHello(message);
    if (this.phase === "proof") return this.handleProof(message);
    return this.handleFrame(message);
  }

  private async handleHello(message: string): Promise<void> {
    const hello = parseHandshake(message);
    if (hello?.t !== "hello") {
      throw new SyncError(
        "protocol",
        "The other device did not begin with hello",
      );
    }
    if (hello.v !== protocolVersion) {
      throw new SyncError(
        "version",
        "The other device uses a different sync version. Update Teneo on the other device.",
      );
    }
    const { deviceId, authKey } = this.options;
    if (hello.deviceId === deviceId) {
      throw new SyncError("protocol", "A device connected to itself");
    }
    this.peerId = hello.deviceId;

    // initiator first, so both sides write the same transcript
    const transcript = this.initiator
      ? [this.nonce, hello.nonce, deviceId, hello.deviceId].join("|")
      : [hello.nonce, this.nonce, hello.deviceId, deviceId].join("|");
    const [mine, theirs] = this.initiator
      ? (["initiator", "responder"] as const)
      : (["responder", "initiator"] as const);
    const [myProof, peerProof, initiatorKey, responderKey] = await Promise.all([
      hmacSha256(authKey, utf8(`${mine}|${transcript}`)),
      hmacSha256(authKey, utf8(`${theirs}|${transcript}`)),
      hkdf(authKey, `session initiator to responder|${transcript}`, 32),
      hkdf(authKey, `session responder to initiator|${transcript}`, 32),
    ]);
    this.peerProof = peerProof;
    this.sendKey = await importAesKey(
      this.initiator ? initiatorKey : responderKey,
    );
    this.receiveKey = await importAesKey(
      this.initiator ? responderKey : initiatorKey,
    );

    this.channel.send(JSON.stringify({ t: "proof", mac: toHex(myProof) }));
    this.phase = "proof";
  }

  private handleProof(message: string): void {
    const proof = parseHandshake(message);
    if (proof?.t !== "proof") {
      throw new SyncError("protocol", "The other device did not send a proof");
    }
    if (!timingSafeEqual(fromHex(proof.mac)!, this.peerProof!)) {
      throw new SyncError(
        "auth",
        "The other device does not hold this vault's key",
      );
    }
    this.phase = "open";
    this.lastHeard = this.now();
    this.stopHeartbeat = this.scheduler.every(heartbeat.everyMs, () =>
      this.beat(),
    );
    this.resolveOpened(this);
  }

  private async handleFrame(message: string): Promise<void> {
    const sealed = fromBase64(message);
    if (!sealed)
      throw new SyncError("protocol", "A message was not valid base64");
    let plaintext: Bytes;
    try {
      plaintext = await unseal(this.receiveKey!, this.receivedCount, sealed);
    } catch {
      throw new SyncError(
        "protocol",
        "A message was altered, repeated or out of order",
      );
    }
    this.receivedCount += 1;
    const frame = parseFrame(fromUtf8(plaintext));
    if (!frame)
      throw new SyncError("protocol", "A message had an unknown shape");

    this.lastHeard = this.now();
    if (frame.t === "ping") {
      this.send({ t: "pong" }).catch(() => undefined);
      return;
    }
    if (frame.t === "pong") return;
    await (
      await this.handler
    )(frame);
  }

  private beat(): void {
    if (this.now() - this.lastHeard > heartbeat.silentMs) {
      this.end(new SyncError("timeout", "The other device stopped answering"));
      return;
    }
    this.send({ t: "ping" }).catch(() => undefined);
  }

  private end(error: SyncError | null): void {
    if (this.phase === "closed") return;
    this.phase = "closed";
    this.stopHeartbeat?.();
    this.channel.close(error?.code);
    this.rejectOpened(
      error ?? new SyncError("closed", "Closed before it opened"),
    );
    this.resolveClosed(error);
  }
}
