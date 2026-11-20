// The sync core's only crypto: WebCrypto plus a few encoders. What the
// handshake, the encrypted frames and the pairing codes need lives here.

export type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const utf8 = (text: string): Bytes => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array): string => decoder.decode(bytes);

export function randomBytes(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

export function concatBytes(...parts: Uint8Array[]): Bytes {
  const joined = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    joined.set(part, offset);
    offset += part.length;
  }
  return joined;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i]! ^ b[i]!;
  return difference === 0;
}

// --- hex and base64 (written out: not every runtime has the built-ins)

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function fromHex(hex: string): Bytes | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const base64Alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const base64Lookup = new Int8Array(128).fill(-1);
for (let i = 0; i < 64; i++) base64Lookup[base64Alphabet.charCodeAt(i)] = i;
base64Lookup["=".charCodeAt(0)] = 0; // padding decodes as zero bits

export function toBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  const chunkSize = 3072; // bytes: a multiple of 3, so chunks join without padding
  for (let start = 0; start < bytes.length; start += chunkSize) {
    const end = Math.min(start + chunkSize, bytes.length);
    let chunk = "";
    for (let i = start; i < end; i += 3) {
      const n =
        (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
      chunk +=
        base64Alphabet[(n >> 18) & 63]! +
        base64Alphabet[(n >> 12) & 63]! +
        (i + 1 < bytes.length ? base64Alphabet[(n >> 6) & 63]! : "=") +
        (i + 2 < bytes.length ? base64Alphabet[n & 63]! : "=");
    }
    chunks.push(chunk);
  }
  return chunks.join("");
}

export function fromBase64(text: string): Bytes | null {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text))
    return null;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  const bytes = new Uint8Array((text.length / 4) * 3 - padding);
  let out = 0;
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (base64Lookup[text.charCodeAt(i)]! << 18) |
      (base64Lookup[text.charCodeAt(i + 1)]! << 12) |
      (base64Lookup[text.charCodeAt(i + 2)]! << 6) |
      base64Lookup[text.charCodeAt(i + 3)]!;
    if (out < bytes.length) bytes[out++] = (n >> 16) & 255;
    if (out < bytes.length) bytes[out++] = (n >> 8) & 255;
    if (out < bytes.length) bytes[out++] = n & 255;
  }
  return bytes;
}

// --- hashing, key derivation, encryption

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function hmacSha256(key: Bytes, data: Bytes): Promise<Bytes> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", hmacKey, data));
}

/** HKDF-SHA256 of `secret`: one label gives one independent key. */
export async function hkdf(
  secret: Bytes,
  label: string,
  length: number,
): Promise<Bytes> {
  const material = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: utf8("teneo-sync"),
      info: utf8(label),
    },
    material,
    length * 8,
  );
  return new Uint8Array(bits);
}

export interface VaultKeys {
  /** Proves a device holds the vault key, and derives each session's keys. */
  authKey: Bytes;
  /** Encrypts data at rest in a relay. Unused until there is one. */
  dataKey: Bytes;
  /** Lets devices find each other without naming the vault: 8 bytes, hex. */
  tag: string;
}

export async function deriveVaultKeys(vaultKey: Bytes): Promise<VaultKeys> {
  // "tag" in version 1 was announced as it is, so anyone who heard it knows
  // it: discovery now uses a key of its own, which is never sent
  const [authKey, dataKey, tag] = await Promise.all([
    hkdf(vaultKey, "authKey", 32),
    hkdf(vaultKey, "dataKey", 32),
    hkdf(vaultKey, "discovery v2", 32),
  ]);
  return { authKey, dataKey, tag: toHex(tag) };
}

/** One connection's own key pair, thrown away when it ends: what is agreed
 *  with it can't be worked out later from the vault key alone. */
export interface EphemeralKey {
  privateKey: CryptoKey;
  /** The public key, raw (65 bytes), base64. */
  publicKey: string;
}

const ecdh = { name: "ECDH", namedCurve: "P-256" } as const;

export async function ephemeralKey(): Promise<EphemeralKey> {
  const pair = (await crypto.subtle.generateKey(ecdh, false, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return { privateKey: pair.privateKey, publicKey: toBase64(raw) };
}

/** The secret both ends of a connection agree, or null when the other
 *  end's key isn't a point on the curve. */
export async function sharedSecret(
  privateKey: CryptoKey,
  peerPublicKey: string,
): Promise<Bytes | null> {
  const raw = fromBase64(peerPublicKey);
  if (!raw || raw.length !== 65) return null;
  try {
    const peer = await crypto.subtle.importKey("raw", raw, ecdh, false, []);
    return new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: peer },
        privateKey,
        256,
      ),
    );
  } catch {
    return null;
  }
}

export function importAesKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}

// The nonce is the frame's number in its direction: 4 zero bytes, then the
// counter. A frame replayed, dropped or reordered is decrypted with the wrong
// nonce, so it fails.
function counterNonce(counter: number): Bytes {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32));
  view.setUint32(8, counter >>> 0);
  return nonce;
}

export async function seal(
  key: CryptoKey,
  counter: number,
  plaintext: Bytes,
): Promise<Bytes> {
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: counterNonce(counter) },
    key,
    plaintext,
  );
  return new Uint8Array(sealed);
}

/** Throws when the frame is not the one at `counter`, or was altered. */
export async function unseal(
  key: CryptoKey,
  counter: number,
  sealed: Bytes,
): Promise<Bytes> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: counterNonce(counter) },
    key,
    sealed,
  );
  return new Uint8Array(plaintext);
}

// --- recovery code and pairing link

// Crockford base32: no I, L, O or U, so a code read aloud or copied by hand
// survives. Decoding also accepts O for 0 and I or L for 1.
const crockford = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function toBase32(bytes: Uint8Array): string {
  let out = "";
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += crockford[(value >> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += crockford[(value << (5 - bits)) & 31];
  return out;
}

function normalizeBase32(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
}

/** Null when the text has a character outside the alphabet, or leftover bits. */
export function fromBase32(text: string): Bytes | null {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of normalizeBase32(text)) {
    const digit = crockford.indexOf(char);
    if (digit < 0) return null;
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return value === 0 ? Uint8Array.from(bytes) : null;
}

const vaultKeyLength = 32;
const checksumLength = 4; // base32 characters: 20 bits of the key's SHA-256

async function checksum(vaultKey: Bytes): Promise<string> {
  return toBase32(await sha256(vaultKey)).slice(0, checksumLength);
}

/** The vault key as 14 groups of four: the key, then a checksum group that
 *  catches a mistyped character before a join is attempted. */
export async function formatRecoveryCode(vaultKey: Bytes): Promise<string> {
  const text = toBase32(vaultKey) + (await checksum(vaultKey));
  return text.match(/.{1,4}/g)!.join("-");
}

/** The vault key, or null when the code is mistyped or incomplete. */
export async function parseRecoveryCode(code: string): Promise<Bytes | null> {
  const normalized = normalizeBase32(code);
  const vaultKey = fromBase32(normalized.slice(0, -checksumLength));
  if (!vaultKey || vaultKey.length !== vaultKeyLength) return null;
  return normalized.slice(-checksumLength) === (await checksum(vaultKey))
    ? vaultKey
    : null;
}

const addressPattern = /^[A-Za-z0-9.\-[\]:]+:\d{1,5}$/;

/** What a pairing code's link holds. Version 1 (Teneo 0.4 and earlier) held
 *  the vault key itself; version 2 holds a one-time key the Mac takes for a
 *  few minutes, and only once (engine.ts › pair), so a photo of the code is
 *  of no use later. */
export type PairingLink =
  | { kind: "vault"; vaultKey: Bytes; addresses: string[] }
  | { kind: "pairing"; pairingKey: Bytes; addresses: string[] };

/** The text of the QR code: `teneo://pair?v=2&p=<one-time key>&a=<host:port,...>`. */
export function buildPairingLink(
  pairingKey: Bytes,
  addresses: string[],
): string {
  if (addresses.some((address) => !addressPattern.test(address))) {
    throw new Error("A pairing address must look like host:port");
  }
  return `teneo://pair?v=2&p=${toBase32(pairingKey)}&a=${addresses.join(",")}`;
}

export function parsePairingLink(link: string): PairingLink | null {
  const prefix = "teneo://pair?";
  if (!link.startsWith(prefix)) return null;
  const params = new URLSearchParams(link.slice(prefix.length));
  const version = params.get("v");
  const key = fromBase32(params.get(version === "2" ? "p" : "k") ?? "");
  if (!key || key.length !== vaultKeyLength) return null;
  const addresses = (params.get("a") ?? "").split(",").filter(Boolean);
  if (!addresses.every((address) => addressPattern.test(address))) return null;
  if (version === "2") return { kind: "pairing", pairingKey: key, addresses };
  if (version === "1") return { kind: "vault", vaultKey: key, addresses };
  return null;
}
