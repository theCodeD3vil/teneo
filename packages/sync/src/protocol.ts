// Connection protocol, version 1. Two plain handshake messages (hello, proof)
// are followed by encrypted frames. Messages are strings: JSON for the
// handshake, base64 of the AES-GCM ciphertext of a JSON frame after it.
import { isDeviceId } from "./hlc";

export const protocolVersion = 1;

export const batchLimits = { items: 200, bytes: 256 * 1024 };
export const heartbeat = { everyMs: 15_000, silentMs: 45_000 };
/** How long a connection has to finish the handshake, so a device that opens
 *  one and says nothing cannot hold it forever. */
export const handshakeMs = 10_000;

/** The largest message a device accepts, before decrypting it. */
export const maxMessageLength = 8 * 1024 * 1024;

/** How far one device has read another's changes. */
export interface Cursor {
  /** The other store's epoch when it was read; null before the first read. */
  epoch: string | null;
  seq: number;
}

export interface Hello {
  t: "hello";
  v: number;
  deviceId: string;
  /** 16 random bytes, hex. */
  nonce: string;
}

export interface Proof {
  t: "proof";
  /** HMAC-SHA256, hex. */
  mac: string;
}

export interface StateFrame {
  t: "state";
  /** The sender's store epoch. */
  epoch: string;
  name: string;
  platform: string;
  /** How far the sender has read the receiver's changes. */
  cursor: Cursor;
}

export interface ChangesFrame {
  t: "changes";
  epoch: string;
  /** Not yet validated: each item goes through parseRecord. */
  items: unknown[];
  /** Everything up to this syncSeq of the sender's has been sent. */
  upTo: number;
  /** Another batch follows at once. */
  more: boolean;
}

export interface PingFrame {
  t: "ping";
}
export interface PongFrame {
  t: "pong";
}

export type Frame = StateFrame | ChangesFrame | PingFrame | PongFrame;

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const isCount = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

const isShortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= max;

export function parseHandshake(text: string): Hello | Proof | null {
  const m = parseJson(text);
  if (!m) return null;
  if (m.t === "hello") {
    const nonce = m.nonce;
    if (!isCount(m.v) || !isDeviceId(m.deviceId)) return null;
    if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return null;
    return { t: "hello", v: m.v, deviceId: m.deviceId, nonce };
  }
  if (m.t === "proof") {
    return typeof m.mac === "string" && /^[0-9a-f]{64}$/.test(m.mac)
      ? { t: "proof", mac: m.mac }
      : null;
  }
  return null;
}

export function parseFrame(text: string): Frame | null {
  const m = parseJson(text);
  if (!m) return null;
  switch (m.t) {
    case "ping":
      return { t: "ping" };
    case "pong":
      return { t: "pong" };
    case "state": {
      const cursor = m.cursor as Record<string, unknown> | null;
      if (!isShortText(m.epoch, 64) || !isShortText(m.name, 128)) return null;
      if (!isShortText(m.platform, 32)) return null;
      if (typeof cursor !== "object" || cursor === null) return null;
      if (cursor.epoch !== null && !isShortText(cursor.epoch, 64)) return null;
      if (!isCount(cursor.seq)) return null;
      return {
        t: "state",
        epoch: m.epoch,
        name: m.name,
        platform: m.platform,
        cursor: { epoch: cursor.epoch, seq: cursor.seq },
      };
    }
    case "changes": {
      if (!isShortText(m.epoch, 64) || !isCount(m.upTo)) return null;
      if (typeof m.more !== "boolean" || !Array.isArray(m.items)) return null;
      if (m.items.length > batchLimits.items) return null;
      return {
        t: "changes",
        epoch: m.epoch,
        items: m.items,
        upTo: m.upTo,
        more: m.more,
      };
    }
    default:
      return null;
  }
}
