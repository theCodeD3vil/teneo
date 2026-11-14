/** An ordered, reliable pipe of string messages between two devices: a
 *  WebSocket on the Mac. Whatever a transport is, it hands the engine one. */
export interface Channel {
  /** True on the side that opened the connection. */
  readonly initiator: boolean;
  /** Where the other side is, when the transport knows. */
  readonly remoteAddress?: string;
  send(message: string): void;
  /** Set once, before messages arrive. */
  onMessage(handler: (message: string) => void): void;
  /** Called once when the connection ends, whichever side ended it. */
  onClose(handler: (reason?: string) => void): void;
  close(reason?: string): void;
}

export interface MemoryPair {
  initiator: Channel;
  responder: Channel;
  /** Messages sent but not yet handed to the other side. */
  pending(): number;
}

export interface MemoryPairOptions {
  /** Sees every message on its way and returns what to deliver instead: none
   *  to drop it, two to replay it, another string to alter it. */
  intercept?: (from: "initiator" | "responder", message: string) => string[];
}

type Delivery = { message: string } | { close: string | undefined };

interface MemoryEnd extends Channel {
  receive(delivery: Delivery): void;
}

/** Two connected channels in one process, for tests. Delivery is in order and
 *  asynchronous, like a socket. */
export function memoryChannelPair(options: MemoryPairOptions = {}): MemoryPair {
  let pending = 0;
  let closed = false;
  const ends: MemoryEnd[] = [];

  function makeEnd(index: 0 | 1): MemoryEnd {
    const inbox: Delivery[] = [];
    let messageHandler: ((message: string) => void) | null = null;
    let closeHandler: ((reason?: string) => void) | null = null;
    let drainScheduled = false;
    const otherEnd = () => ends[1 - index]!;

    function drain(): void {
      drainScheduled = false;
      while (inbox.length > 0) {
        const next = inbox[0]!;
        // wait for the handler: nothing is lost, and order is kept
        if ("message" in next ? !messageHandler : !closeHandler) return;
        inbox.shift();
        if ("message" in next) messageHandler!(next.message);
        else closeHandler!(next.close);
        pending -= 1;
      }
    }

    function scheduleDrain(): void {
      if (drainScheduled) return;
      drainScheduled = true;
      queueMicrotask(drain);
    }

    const end: MemoryEnd = {
      initiator: index === 0,
      send(message) {
        if (closed) return;
        const from = index === 0 ? "initiator" : "responder";
        for (const m of options.intercept
          ? options.intercept(from, message)
          : [message]) {
          otherEnd().receive({ message: m });
        }
      },
      onMessage(handler) {
        messageHandler = handler;
        scheduleDrain();
      },
      onClose(handler) {
        closeHandler = handler;
        scheduleDrain();
      },
      close(reason) {
        if (closed) return;
        closed = true;
        otherEnd().receive({ close: reason });
        end.receive({ close: reason });
      },
      receive(delivery) {
        pending += 1;
        inbox.push(delivery);
        scheduleDrain();
      },
    };
    return end;
  }

  ends.push(makeEnd(0), makeEnd(1));
  return { initiator: ends[0]!, responder: ends[1]!, pending: () => pending };
}
