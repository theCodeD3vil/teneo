// A Session turns a Channel into an authenticated, encrypted frame pipe.
//
//   1. both send hello { v, nonce, eph }: eph is a P-256 key made for this
//      connection alone (and a random deviceId, which only version 1 read)
//   2. both agree an ECDH secret, and derive every key from it and the vault's
//      authKey together, bound to both nonces and both eph keys: a recording
//      of the connection stays sealed even to someone who later learns the
//      vault key, as the eph keys are gone by then (forward secrecy)
//   3. both send a sealed proof. v2 proves knowledge of the vault key.
//      v3 signs the transcript and proves membership in the local signed
//      device list; the shared vault key cannot authenticate a device.
//   4. every later message is AES-GCM of one JSON frame, keyed per direction,
//      with the frame's number as nonce
import type { Channel } from "./channel";
import {
  type Bytes,
  concatBytes,
  type EphemeralKey,
  ephemeralKey,
  fromBase64,
  fromHex,
  fromUtf8,
  hkdf,
  hmacSha256,
  importAesKey,
  randomBytes,
  seal,
  sharedSecret,
  timingSafeEqual,
  toBase64,
  toHex,
  unseal,
  utf8,
} from "./crypto";
import {
  type Frame,
  type PingFrame,
  type PongFrame,
  handshakeMs,
  heartbeat,
  maxMessageLength,
  parseFrame,
  parseHello,
  parseProof,
  protocolVersion,
} from "./protocol";
import {
  acceptsIdentity,
  type DeviceIdentity,
  type DevicePublicIdentity,
  parseDeviceIdentity,
  type VaultPin,
  type VaultTrust,
  verifyDeviceSignature,
} from "./vault-trust";

const identityProtocolVersion = 3;
const fingerprintPattern = /^[0-9a-f]{64}$/;

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

interface CommonSessionOptions {
  deviceId: string;
  scheduler?: Scheduler;
  now?: () => number;
  /** How long the handshake may take. */
  handshakeMs?: number;
}

export interface EnrollmentInvite {
  /** 32 random bytes, handed to the joining device out of band. */
  readonly key: Bytes;
  readonly pin: VaultPin;
}

export type SessionOptions = CommonSessionOptions &
  (
    | {
        authKey: Bytes;
        /** One-time legacy pairing key, accepted by a responder only. */
        pairingAuthKey?: Bytes;
        identity?: never;
        trust?: never;
        invite?: never;
      }
    | {
        identity: DeviceIdentity;
        trust: VaultTrust;
        /** A primary responder accepts this one-time invite, if active. */
        invite?: EnrollmentInvite;
        authKey?: never;
        pairingAuthKey?: never;
      }
    | {
        identity: DeviceIdentity;
        trust?: never;
        /** An initiator without a trust snapshot redeems this invite. */
        invite: EnrollmentInvite;
        authKey?: never;
        pairingAuthKey?: never;
      }
  );

interface ConnectionKeys {
  myProofKey: CryptoKey;
  peerProofKey: CryptoKey;
  sendKey: CryptoKey;
  receiveKey: CryptoKey;
}

/** What one auth key gives a connection. */
interface Candidate extends ConnectionKeys {
  authKey: Bytes;
}

interface IdentityProof {
  deviceId: string;
  generation: number;
  fingerprint: string;
}

export type FrameHandler = (
  frame: Exclude<Frame, PingFrame | PongFrame>,
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

  /** The device proved the pairing key, not the vault's. */
  usedPairingKey = false;

  /** For an authenticated identity on a different generation, only the
   *  primary can send a trust update and the receiver can acknowledge it. */
  private trustLane: "send" | "receive" | null = null;
  private trustFingerprint: string | null = null;
  private trustGeneration: number | null = null;
  private enrollmentKeys: ConnectionKeys | null = null;
  /** The public identity authenticated on an enrollment-only connection. */
  enrollmentPeer: DevicePublicIdentity | null = null;
  get trustUpdateDirection(): "send" | "receive" | null {
    return this.trustLane;
  }

  private phase: Phase = "hello";
  private readonly ephemeral: Promise<EphemeralKey>;
  /** Both nonces and both eph keys, initiator's first. */
  private transcript = "";
  /** The keys of each auth key this side takes, until the peer's proof says
   *  which one it holds. */
  private candidates: Candidate[] = [];
  private identityKeys: ConnectionKeys | null = null;
  /** This side's proof waits for the peer's when there is a choice. */
  private proofSent = false;
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
    this.ephemeral = ephemeralKey();
    this.ephemeral.then(
      (key) => {
        if (this.phase === "closed") return;
        channel.send(
          JSON.stringify({
            t: "hello",
            v: this.options.identity
              ? identityProtocolVersion
              : protocolVersion,
            deviceId: toHex(randomBytes(16)),
            nonce: this.nonce,
            eph: key.publicKey,
            ...(this.options.identity &&
              !this.options.trust &&
              this.initiator && { enroll: true }),
          }),
        );
      },
      (error: unknown) =>
        this.end(
          new SyncError(
            "failed",
            `Making a connection key failed: ${String(error)}`,
          ),
        ),
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
        this.checkTrustFrame(frame, this.trustLane === "send");
        // the counter is taken here, in send order, not when send() was called
        const counter = this.sentCount++;
        const sealed = await seal(
          this.sendKey!,
          counter,
          utf8(JSON.stringify(frame)),
        );
        if (this.phase !== "open")
          throw new SyncError("closed", "Connection closed");
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

  private roles(): readonly [
    "initiator" | "responder",
    "initiator" | "responder",
  ] {
    return this.initiator
      ? (["initiator", "responder"] as const)
      : (["responder", "initiator"] as const);
  }

  private async handleHello(message: string): Promise<void> {
    const hello = parseHello(message);
    if (!hello) {
      throw new SyncError(
        "protocol",
        "The other device did not begin with hello",
      );
    }
    const version = this.options.identity
      ? identityProtocolVersion
      : protocolVersion;
    if (hello.v !== version) {
      throw new SyncError(
        "version",
        "The other device uses a different sync version. Update Teneo on the other device.",
      );
    }
    if (!hello.eph) {
      throw new SyncError("protocol", "The other device offered no key");
    }
    const mine = await this.ephemeral;
    const shared = await sharedSecret(mine.privateKey, hello.eph);
    if (!shared) {
      throw new SyncError("protocol", "The other device's key isn't one");
    }

    // initiator first, so both sides write the same transcript
    this.transcript = (
      this.initiator
        ? [this.nonce, hello.nonce, mine.publicKey, hello.eph]
        : [hello.nonce, this.nonce, hello.eph, mine.publicKey]
    ).join("|");
    if (this.options.identity) {
      const { identity, invite, trust } = this.options;
      if (identity.deviceId !== this.options.deviceId)
        throw new SyncError("auth", "This device's identity is not valid");
      if (hello.enroll && this.initiator)
        throw new SyncError("protocol", "Only an initiator can enroll");
      if (hello.enroll || !trust) {
        if (
          !invite ||
          invite.key.length !== 32 ||
          (!trust && !this.initiator) ||
          (trust &&
            (trust.pin.vaultId !== invite.pin.vaultId ||
              !acceptsIdentity(trust.pin.primary, invite.pin.primary) ||
              !acceptsIdentity(trust.pin.primary, identity)))
        )
          throw new SyncError("auth", "No valid enrollment invitation");
        this.enrollmentKeys = await this.deriveConnectionKeys(
          concatBytes(invite.key, shared),
          `v3 enrollment|${invite.pin.vaultId}`,
        );
        await this.sendEnrollmentProof(this.enrollmentKeys, invite, identity);
        if (!this.isClosed()) this.phase = "proof";
        return;
      }
      if (!acceptsIdentity(trust.member(this.options.deviceId), identity))
        throw new SyncError("auth", "This device is not in the trusted list");
      this.identityKeys = await this.deriveConnectionKeys(
        shared,
        `v3 identity|${trust.pin.vaultId}`,
      );
      await this.sendIdentityProof(this.identityKeys, { identity, trust });
      if (!this.isClosed()) this.phase = "proof";
      return;
    }
    const { authKey } = this.options;
    const keys = [
      authKey,
      ...(this.options.pairingAuthKey && !this.initiator
        ? [this.options.pairingAuthKey]
        : []),
    ];
    this.candidates = await Promise.all(
      keys.map((key) => this.deriveCandidate(key, shared)),
    );
    // with one key there is nothing to wait for
    if (this.candidates.length === 1) await this.sendProof(this.candidates[0]!);
    if (!this.isClosed()) this.phase = "proof";
  }

  private isClosed(): boolean {
    return this.phase === "closed";
  }

  private async deriveCandidate(
    authKey: Bytes,
    shared: Bytes,
  ): Promise<Candidate> {
    return {
      authKey,
      ...(await this.deriveConnectionKeys(concatBytes(authKey, shared), "v2")),
    };
  }

  private async deriveConnectionKeys(
    secret: Bytes,
    domain: string,
  ): Promise<ConnectionKeys> {
    const label = (name: string) => `${domain} ${name}|${this.transcript}`;
    const [proofI, proofR, initiatorKey, responderKey] = await Promise.all([
      hkdf(secret, label("proof initiator"), 32),
      hkdf(secret, label("proof responder"), 32),
      hkdf(secret, label("session initiator to responder"), 32),
      hkdf(secret, label("session responder to initiator"), 32),
    ]);
    const [mine, theirs] = this.initiator ? [proofI, proofR] : [proofR, proofI];
    const [send, receive] = this.initiator
      ? [initiatorKey, responderKey]
      : [responderKey, initiatorKey];
    return {
      myProofKey: await importAesKey(mine),
      peerProofKey: await importAesKey(theirs),
      sendKey: await importAesKey(send),
      receiveKey: await importAesKey(receive),
    };
  }

  private identityProofBytes(
    vaultId: string,
    role: string,
    { deviceId, generation, fingerprint }: IdentityProof,
  ): Bytes {
    return utf8(
      JSON.stringify([
        "teneo sync identity proof 3",
        vaultId,
        role,
        this.transcript,
        deviceId,
        generation,
        fingerprint,
      ]),
    );
  }

  private enrollmentProofBytes(
    invite: EnrollmentInvite,
    role: string,
    { deviceId, publicKey }: DevicePublicIdentity,
  ): Bytes {
    return utf8(
      JSON.stringify([
        "teneo sync enrollment proof 3",
        invite.pin.vaultId,
        invite.pin.primary.deviceId,
        invite.pin.primary.publicKey,
        role,
        this.transcript,
        deviceId,
        publicKey,
      ]),
    );
  }

  private async sendEnrollmentProof(
    keys: ConnectionKeys,
    invite: EnrollmentInvite,
    signer: DeviceIdentity,
  ): Promise<void> {
    const [mine] = this.roles();
    const signature = await signer.sign(
      this.enrollmentProofBytes(invite, mine, signer),
    );
    const sealed = await seal(
      keys.myProofKey,
      0,
      utf8(
        JSON.stringify({
          deviceId: signer.deviceId,
          publicKey: signer.publicKey,
          signature: toBase64(signature),
        }),
      ),
    );
    if (!this.isClosed()) this.channel.send(toBase64(sealed));
  }

  private async handleEnrollmentProof(
    sealed: Bytes,
    keys: ConnectionKeys,
    invite: EnrollmentInvite,
  ): Promise<void> {
    let proof: { signature?: unknown };
    try {
      proof = JSON.parse(fromUtf8(await unseal(keys.peerProofKey, 0, sealed)));
    } catch {
      throw new SyncError("auth", "The enrollment proof could not be opened");
    }
    const admitted = parseDeviceIdentity(proof);
    const [, theirs] = this.roles();
    if (
      !admitted ||
      admitted.deviceId === this.options.deviceId ||
      (this.initiator && !acceptsIdentity(invite.pin.primary, admitted)) ||
      !(await verifyDeviceSignature(
        admitted,
        this.enrollmentProofBytes(invite, theirs, admitted),
        proof.signature,
      ))
    )
      throw new SyncError("auth", "The enrollment identity is not valid");
    this.enrollmentKeys = null;
    this.enrollmentPeer = admitted;
    this.trustLane = this.initiator ? "receive" : "send";
    this.finishHandshake(keys, admitted.deviceId);
  }

  private async sendIdentityProof(
    keys: ConnectionKeys,
    { identity, trust }: { identity: DeviceIdentity; trust: VaultTrust },
  ): Promise<void> {
    const [mine] = this.roles();
    const proof: IdentityProof = {
      deviceId: identity.deviceId,
      generation: trust.generation,
      fingerprint: trust.fingerprint,
    };
    const signature = await identity.sign(
      this.identityProofBytes(trust.pin.vaultId, mine, proof),
    );
    const sealed = await seal(
      keys.myProofKey,
      0,
      utf8(JSON.stringify({ ...proof, signature: toBase64(signature) })),
    );
    if (this.phase !== "closed") this.channel.send(toBase64(sealed));
  }

  private async handleIdentityProof(
    sealed: Bytes,
    keys: ConnectionKeys,
    trust: VaultTrust,
  ): Promise<void> {
    let proof: Partial<IdentityProof> & { signature?: unknown };
    try {
      proof = JSON.parse(fromUtf8(await unseal(keys.peerProofKey, 0, sealed)));
    } catch {
      throw new SyncError("auth", "The device identity could not be opened");
    }
    if (
      !proof ||
      typeof proof.deviceId !== "string" ||
      proof.deviceId === this.options.deviceId ||
      typeof proof.generation !== "number" ||
      !Number.isSafeInteger(proof.generation) ||
      proof.generation < 1 ||
      typeof proof.fingerprint !== "string" ||
      !fingerprintPattern.test(proof.fingerprint)
    )
      throw new SyncError("auth", "The device identity is invalid");
    const admitted = trust.member(proof.deviceId);
    const [, theirs] = this.roles();
    if (
      !admitted ||
      !(await verifyDeviceSignature(
        admitted,
        this.identityProofBytes(trust.pin.vaultId, theirs, {
          deviceId: proof.deviceId,
          generation: proof.generation,
          fingerprint: proof.fingerprint,
        }),
        proof.signature,
      ))
    )
      throw new SyncError("auth", "The device is not trusted");

    if (proof.generation === trust.generation) {
      if (proof.fingerprint !== trust.fingerprint)
        throw new SyncError("auth", "Conflicting trusted device lists");
    } else if (
      proof.generation < trust.generation &&
      this.options.deviceId === trust.pin.primary.deviceId
    ) {
      this.trustLane = "send";
      this.trustFingerprint = trust.fingerprint;
    } else if (
      proof.generation > trust.generation &&
      proof.deviceId === trust.pin.primary.deviceId
    ) {
      this.trustLane = "receive";
      this.trustFingerprint = proof.fingerprint;
      this.trustGeneration = proof.generation;
    } else {
      throw new SyncError("auth", "Reconnect to the primary device to update");
    }
    this.identityKeys = null;
    this.finishHandshake(keys, proof.deviceId);
  }

  matchesTrustUpdate(trust: VaultTrust): boolean {
    return (
      this.trustLane === "receive" &&
      trust.generation === this.trustGeneration &&
      trust.fingerprint === this.trustFingerprint
    );
  }

  private async sendProof(candidate: Candidate): Promise<void> {
    const [mine] = this.roles();
    const { deviceId } = this.options;
    const mac = await hmacSha256(
      candidate.authKey,
      utf8(`${mine}|${this.transcript}|${deviceId}`),
    );
    const proof = await seal(
      candidate.myProofKey,
      0,
      utf8(JSON.stringify({ t: "proof", deviceId, mac: toHex(mac) })),
    );
    this.channel.send(toBase64(proof));
    this.proofSent = true;
  }

  private async handleProof(message: string): Promise<void> {
    const sealed = fromBase64(message);
    if (!sealed) {
      throw new SyncError("protocol", "The other device did not send a proof");
    }
    if (this.enrollmentKeys && this.options.invite)
      return this.handleEnrollmentProof(
        sealed,
        this.enrollmentKeys,
        this.options.invite,
      );
    if (this.options.identity && this.options.trust)
      return this.handleIdentityProof(
        sealed,
        this.identityKeys!,
        this.options.trust,
      );
    if (this.options.identity)
      throw new SyncError("protocol", "No enrollment was negotiated");
    // only a key derived from an auth key this side holds opens it
    let opened: { candidate: Candidate; index: number; bytes: Bytes } | null =
      null;
    for (const [index, candidate] of this.candidates.entries()) {
      try {
        const bytes = await unseal(candidate.peerProofKey, 0, sealed);
        opened = { candidate, index, bytes };
        break;
      } catch {
        // not this one
      }
    }
    if (!opened) {
      throw new SyncError(
        "auth",
        "The other device does not hold this vault's key",
      );
    }
    const proof = parseProof(fromUtf8(opened.bytes));
    if (!proof) {
      throw new SyncError("protocol", "The other device's proof is malformed");
    }
    const [, theirs] = this.roles();
    const expected = await hmacSha256(
      opened.candidate.authKey,
      utf8(`${theirs}|${this.transcript}|${proof.deviceId}`),
    );
    if (!timingSafeEqual(fromHex(proof.mac)!, expected)) {
      throw new SyncError(
        "auth",
        "The other device does not hold this vault's key",
      );
    }
    if (proof.deviceId === this.options.deviceId) {
      throw new SyncError("protocol", "A device connected to itself");
    }
    this.usedPairingKey = opened.index === 1;
    if (!this.proofSent) await this.sendProof(opened.candidate);
    this.candidates = [];
    this.finishHandshake(opened.candidate, proof.deviceId);
  }

  private finishHandshake(keys: ConnectionKeys, peerId: string): void {
    if (this.phase === "closed") return;
    this.sendKey = keys.sendKey;
    this.receiveKey = keys.receiveKey;
    this.peerId = peerId;
    this.phase = "open";
    this.lastHeard = this.now();
    this.stopHeartbeat = this.scheduler.every(heartbeat.everyMs, () =>
      this.beat(),
    );
    this.resolveOpened(this);
  }

  private checkTrustFrame(frame: Frame, updateSender: boolean): void {
    if (frame.t === "ping" || frame.t === "pong") return;
    if (
      (this.trustLane &&
        frame.t !== (updateSender ? "trust-update" : "trust-ack")) ||
      (!this.trustLane &&
        (frame.t === "trust-update" || frame.t === "trust-ack")) ||
      (this.options.identity && frame.t === "vault")
    )
      throw new SyncError(
        "protocol",
        "That frame is not allowed in this session",
      );
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
    this.checkTrustFrame(frame, this.trustLane === "receive");

    this.lastHeard = this.now();
    if (frame.t === "ping") {
      this.send({ t: "pong" }).catch(() => undefined);
      return;
    }
    if (frame.t === "pong") return;
    const handler = await this.handler;
    if (this.phase === "open") await handler(frame);
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
    try {
      this.channel.close(error?.code);
    } catch {
      // A broken transport must not keep the session open or block rotation.
    }
    this.rejectOpened(
      error ?? new SyncError("closed", "Closed before it opened"),
    );
    this.resolveClosed(error);
  }
}
