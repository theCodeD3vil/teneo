import type { Channel } from "@teneo/sync";

/** What a WebSocket end can do, whichever side of the connection it is. */
export interface SocketEnd {
  send(message: string): void;
  close(reason?: string): void;
}

/** A WebSocket as the sync engine's Channel. The socket's events call
 *  `deliver` and `ended`. A message that arrives before the engine has set its
 *  handler waits for it: the other device's hello comes straight away, and the
 *  engine is still starting up. */
export class SocketChannel implements Channel {
  readonly initiator: boolean;
  readonly remoteAddress: string | undefined;

  private readonly socket: SocketEnd;
  private readonly waiting: string[] = [];
  private messageHandler: ((message: string) => void) | null = null;
  private closeHandler: ((reason?: string) => void) | null = null;
  private ended_ = false;
  private endReason: string | undefined;
  private told = false;

  constructor(options: {
    initiator: boolean;
    remoteAddress?: string;
    socket: SocketEnd;
  }) {
    this.initiator = options.initiator;
    this.remoteAddress = options.remoteAddress;
    this.socket = options.socket;
  }

  send(message: string): void {
    if (this.ended_) return;
    this.socket.send(message);
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
    if (this.ended_) return;
    this.socket.close(reason);
    this.ended(reason);
  }

  // --- from the socket

  deliver(message: string): void {
    if (this.ended_) return;
    this.waiting.push(message);
    this.drain();
  }

  /** The connection is over, whichever side ended it. */
  ended(reason?: string): void {
    if (this.ended_) return;
    this.ended_ = true;
    this.endReason = reason || undefined;
    this.drain();
  }

  private drain(): void {
    while (this.waiting.length > 0 && this.messageHandler) {
      this.messageHandler(this.waiting.shift()!);
    }
    // the close comes after every message that arrived before it
    if (
      this.ended_ &&
      !this.told &&
      this.waiting.length === 0 &&
      this.closeHandler
    ) {
      this.told = true;
      this.closeHandler(this.endReason);
    }
  }
}
