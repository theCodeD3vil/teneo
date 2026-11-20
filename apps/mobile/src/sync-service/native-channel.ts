import { type Channel, parseBye } from "@teneo/sync";

/** What a native connection can do, whichever side opened it. */
export interface ConnectionEnd {
  send(message: string): void;
  close(reason?: string): void;
}

/** A connection that native code owns, as the sync engine's Channel. The
 *  bridge's events call `deliver` and `ended`. A message that arrives before
 *  the engine has set its handler waits for it: the other device's hello comes
 *  straight away, and the engine is still starting up.
 *
 *  The same logic as the Mac's SocketChannel (apps/desktop/backend/sync/
 *  ws-channel.ts); that one lives in the Mac app, which this app can't import
 *  from. */
/** Messages that may wait for the engine to start listening */
const maxWaiting = 8;

export class NativeChannel implements Channel {
  readonly initiator: boolean;
  readonly remoteAddress: string | undefined;

  private readonly connection: ConnectionEnd;
  private readonly waiting: string[] = [];
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((reason?: string) => void) | null = null;
  private isEnded = false;
  private endReason: string | undefined;
  private isTold = false;

  constructor(options: {
    initiator: boolean;
    remoteAddress?: string;
    connection: ConnectionEnd;
  }) {
    this.initiator = options.initiator;
    this.remoteAddress = options.remoteAddress;
    this.connection = options.connection;
  }

  send(message: string): void {
    if (this.isEnded) return;
    this.connection.send(message);
  }

  onMessage(handler: (message: string) => void): void {
    this.messageHandler = handler;
    this.drain();
  }

  onClose(handler: (reason?: string) => void): void {
    this.closeHandler = handler;
    this.drain();
  }

  close(reason?: string): void {
    if (this.isEnded) return;
    this.connection.close(reason);
    this.ended(reason);
  }

  // --- from the bridge

  deliver(message: string): void {
    if (this.isEnded) return;
    // the other side says why it is closing (byeMessage), and then closes
    const bye = parseBye(message);
    if (bye !== null) {
      this.ended(bye);
      return;
    }
    // Before the engine listens, a peer has sent its hello and nothing else:
    // a pile of messages is one flooding the connection, which ends
    if (!this.messageHandler && this.waiting.length >= maxWaiting) {
      this.close("Too many messages before the handshake");
      return;
    }
    this.waiting.push(message);
    this.drain();
  }

  /** The connection is over, whichever side ended it. */
  ended(reason?: string): void {
    if (this.isEnded) return;
    this.isEnded = true;
    this.endReason = reason || undefined;
    this.drain();
  }

  private drain(): void {
    while (this.waiting.length > 0 && this.messageHandler) {
      this.messageHandler(this.waiting.shift()!);
    }
    // the close comes after every message that arrived before it
    if (
      this.isEnded &&
      !this.isTold &&
      this.waiting.length === 0 &&
      this.closeHandler
    ) {
      this.isTold = true;
      this.closeHandler(this.endReason);
    }
  }
}
