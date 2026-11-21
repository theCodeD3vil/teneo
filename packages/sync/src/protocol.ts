// Connection protocol, version 1. Two plain handshake messages (hello, proof)
// are followed by encrypted frames. Messages are strings: JSON for the
// handshake, base64 of the AES-GCM ciphertext of a JSON frame after it.
//
// The version has not changed since the first release, and a device closes a
// connection over a frame it doesn't know. So what was added later is opt-in:
// a device lists what it understands in its state frame's `caps`, and a frame
// from after the first release is only sent to a device that listed it.
// Fields added to the state frame are simply dropped by a device that doesn't
// know them.
import { isDeviceId } from "./hlc";
import { maxImageBytes } from "./record";

/** 2: each connection agrees a key of its own (ECDH), and a device says who
 *  it is only once the connection is encrypted (session.ts). */
export const protocolVersion = 2;

export const batchLimits = { items: 200, bytes: 256 * 1024 };
export const heartbeat = { everyMs: 15_000, silentMs: 45_000 };
/** How long a connection has to finish the handshake, so a device that opens
 *  one and says nothing cannot hold it forever. */
export const handshakeMs = 10_000;
/** How long a device that was sent a `removed` frame has to close the
 *  connection itself, before it is closed for it. */
export const removedWaitMs = 2000;

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
  /** Version 1 sent the device's id here. Version 2 sends a random one, so a
   *  device on version 1 still reads the hello and says to update; the real
   *  id comes in the sealed proof. */
  deviceId: string;
  /** 16 random bytes, hex. */
  nonce: string;
  /** Version 2: this connection's ECDH P-256 public key, raw, base64. */
  eph?: string;
}

/** What the sealed proof holds, once opened. */
export interface Proof {
  t: "proof";
  deviceId: string;
  /** HMAC-SHA256, hex. */
  mac: string;
}

export interface StateFrame {
  t: "state";
  /** The sender's store epoch. */
  epoch: string;
  name: string;
  platform: string;
  /** Who made the device, such as "google": a phone says, so the others can
   *  show its maker's logo. Absent from a device that doesn't say. */
  maker?: string;
  /** What the sender understands beyond the first release (see `capabilities`). */
  caps?: string[];
  /** Made anew each time the sender is paired (sync turned on, a code
   *  joined). A device that disconnected the sender takes it back once this
   *  has changed. Absent from a device paired before there was one. */
  pairing?: string;
  /** How far the sender has read the receiver's changes. */
  cursor: Cursor;
}

export const capabilities = {
  /** Answers `icons-want` with the icons of the apps it knows */
  appIcons: "app-icons",
  /** Takes image records, and sends and asks for their bytes in blob frames */
  images: "images",
  /** Reads a `removed` frame */
  removal: "removal",
} as const;

/** The sender was told to disconnect the receiver: it takes no connection
 *  from it until the receiver is paired again, and closes this one. Sent
 *  only to a device with the removal capability; another is just closed. */
export interface RemovedFrame {
  t: "removed";
}

/** The bytes of one piece of an image. Small enough that a frame, in base64
 *  and encrypted, stays well under what one message may hold. */
export const blobChunkBytes = 192 * 1024;

/** Asks for the bytes of the image with this hash. Sent only to a device
 *  with the images capability. */
export interface BlobWantFrame {
  t: "blob-want";
  hash: string;
}

/** One piece of an image, in order from offset 0. The last one ends at
 *  `total`. */
export interface BlobFrame {
  t: "blob";
  hash: string;
  offset: number;
  total: number;
  /** base64, at most blobChunkBytes */
  data: string;
}

/** The answer to a `blob-want` for an image the sender doesn't hold, or can
 *  no longer read. */
export interface BlobNoneFrame {
  t: "blob-none";
  hash: string;
}

export const iconLimits = {
  /** names in one `icons-want`, and icons in one `icons` */
  count: 32,
  /** one icon's png */
  bytes: 64 * 1024,
  /** an app's name, as in a record's sourceApp */
  nameLength: 256,
};

/** Asks for the icons of the apps with these names. Sent only to a device
 *  with the appIcons capability. */
export interface IconsWantFrame {
  t: "icons-want";
  names: string[];
}

/** The icons asked for that the sender has; the others are left out. */
export interface IconsFrame {
  t: "icons";
  icons: { name: string; /** base64 */ png: string }[];
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

/** Pairing: the vault key, from the Mac to a phone that proved the pairing
 *  code's one-time key. Never sent on any other connection (engine.ts). */
export interface VaultFrame {
  t: "vault";
  /** 32 bytes, base64 */
  key: string;
}

export type Frame =
  | VaultFrame
  | StateFrame
  | ChangesFrame
  | IconsWantFrame
  | IconsFrame
  | BlobWantFrame
  | BlobFrame
  | BlobNoneFrame
  | RemovedFrame
  | PingFrame
  | PongFrame;

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

const isHash = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f]{64}$/.test(value);

const isShortText = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length >= 1 && value.length <= max;

/** A hello, of any version: the version is checked before the rest is used,
 *  so a device on another one hears "update". */
export function parseHello(text: string): Hello | null {
  const m = parseJson(text);
  if (!m || m.t !== "hello") return null;
  const nonce = m.nonce;
  if (!isCount(m.v) || !isDeviceId(m.deviceId)) return null;
  if (typeof nonce !== "string" || !/^[0-9a-f]{32}$/.test(nonce)) return null;
  // a P-256 point, uncompressed: 65 bytes
  const eph =
    typeof m.eph === "string" &&
    /^[A-Za-z0-9+/]{86}[A-Za-z0-9+/=]=$/.test(m.eph)
      ? m.eph
      : undefined;
  return {
    t: "hello",
    v: m.v,
    deviceId: m.deviceId,
    nonce,
    ...(eph && { eph }),
  };
}

/** The proof inside its seal. */
export function parseProof(text: string): Proof | null {
  const m = parseJson(text);
  if (!m || m.t !== "proof" || !isDeviceId(m.deviceId)) return null;
  return typeof m.mac === "string" && /^[0-9a-f]{64}$/.test(m.mac)
    ? { t: "proof", deviceId: m.deviceId, mac: m.mac }
    : null;
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
      // added after the first release: one that is missing or malformed is
      // left out, never a reason to refuse the device
      const caps = Array.isArray(m.caps)
        ? m.caps.filter((cap) => isShortText(cap, 32)).slice(0, 32)
        : [];
      return {
        t: "state",
        epoch: m.epoch,
        name: m.name,
        platform: m.platform,
        ...(isShortText(m.maker, 64) ? { maker: m.maker } : {}),
        ...(caps.length > 0 ? { caps } : {}),
        ...(isShortText(m.pairing, 64) ? { pairing: m.pairing } : {}),
        cursor: { epoch: cursor.epoch, seq: cursor.seq },
      };
    }
    case "icons-want": {
      if (!Array.isArray(m.names) || m.names.length > iconLimits.count) {
        return null;
      }
      if (!m.names.every((name) => isShortText(name, iconLimits.nameLength))) {
        return null;
      }
      return { t: "icons-want", names: m.names as string[] };
    }
    case "icons": {
      if (!Array.isArray(m.icons) || m.icons.length > iconLimits.count) {
        return null;
      }
      const icons: IconsFrame["icons"] = [];
      for (const icon of m.icons as unknown[]) {
        if (typeof icon !== "object" || icon === null) return null;
        const { name, png } = icon as Record<string, unknown>;
        if (!isShortText(name, iconLimits.nameLength)) return null;
        // base64 is four characters for every three bytes
        if (!isShortText(png, Math.ceil(iconLimits.bytes / 3) * 4)) return null;
        icons.push({ name, png });
      }
      return { t: "icons", icons };
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
    case "blob-want":
    case "blob-none":
      return isHash(m.hash) ? { t: m.t, hash: m.hash } : null;
    case "removed":
      return { t: "removed" };
    case "vault":
      return typeof m.key === "string" && /^[A-Za-z0-9+/]{43}=$/.test(m.key)
        ? { t: "vault", key: m.key }
        : null;
    case "blob": {
      if (!isHash(m.hash) || !isCount(m.offset) || !isCount(m.total)) {
        return null;
      }
      if (m.total < 1 || m.total > maxImageBytes) return null;
      // base64 is four characters for every three bytes
      if (!isShortText(m.data, Math.ceil(blobChunkBytes / 3) * 4)) return null;
      return {
        t: "blob",
        hash: m.hash,
        offset: m.offset,
        total: m.total,
        data: m.data,
      };
    }
    default:
      return null;
  }
}
