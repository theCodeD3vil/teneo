// A vault's authority is a pinned primary device, not possession of its key.
// The caller must persist each accepted VaultTrust snapshot atomically before
// using it or acknowledging it. Never load it from a rollback-prone backup.
import {
  type Bytes,
  fromBase64,
  randomBytes,
  sha256,
  toBase64,
  toHex,
  utf8,
} from "./crypto";
import { isDeviceId } from "./hlc";

export interface DevicePublicIdentity {
  readonly deviceId: string;
  /** Uncompressed P-256 point (X9.63), canonical base64. */
  readonly publicKey: string;
}

export interface DeviceIdentity extends DevicePublicIdentity {
  /** ECDSA P-256 with SHA-256; returns a 64-byte IEEE P1363 signature. */
  sign(message: Bytes): Promise<Bytes>;
}

export interface VaultPin {
  readonly vaultId: string;
  readonly primary: DevicePublicIdentity;
}

interface Membership {
  readonly vaultId: string;
  readonly generation: number;
  readonly primaryId: string;
  readonly keyHash: string;
  readonly members: readonly DevicePublicIdentity[];
}

export interface VaultTrustUpdate {
  readonly membership: Membership;
  readonly signature: string;
  /** Secret. Only send in a session authenticated to a retained identity. */
  readonly vaultKey: string;
}

const maxVaultMembers = 64;
const hex256 = /^[0-9a-f]{64}$/;
const p256 = { name: "ECDSA", namedCurve: "P-256" } as const;

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function canonicalBytes(value: unknown, size: number): Bytes | null {
  if (typeof value !== "string" || value.length !== Math.ceil(size / 3) * 4)
    return null;
  const bytes = fromBase64(value);
  return bytes?.length === size && toBase64(bytes) === value ? bytes : null;
}

export function parseDeviceIdentity(
  value: unknown,
): DevicePublicIdentity | null {
  const obj = object(value);
  if (!obj || !isDeviceId(obj.deviceId)) return null;
  if (typeof obj.publicKey !== "string") return null;
  const point = canonicalBytes(obj.publicKey, 65);
  if (point?.[0] !== 4) return null;
  return Object.freeze({ deviceId: obj.deviceId, publicKey: obj.publicKey });
}

export function acceptsIdentity(
  admitted: DevicePublicIdentity | undefined,
  device: DevicePublicIdentity,
): boolean {
  return (
    admitted !== undefined &&
    admitted.deviceId === device.deviceId &&
    admitted.publicKey === device.publicKey
  );
}

/** Short comparison label; never used as the actual identity or signing key. */
export async function deviceFingerprint(
  device: DevicePublicIdentity,
): Promise<string> {
  return toHex(
    await sha256(utf8(`teneo device fingerprint 1|${device.publicKey}`)),
  )
    .slice(0, 12)
    .toUpperCase()
    .match(/.{4}/g)!
    .join("-");
}

export async function verifyDeviceSignature(
  device: DevicePublicIdentity,
  message: Bytes,
  signature: unknown,
): Promise<boolean> {
  const sig = canonicalBytes(signature, 64);
  const point = canonicalBytes(device.publicKey, 65);
  if (!sig || point?.[0] !== 4) return false;
  try {
    const key = await crypto.subtle.importKey("raw", point, p256, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      sig,
      message,
    );
  } catch {
    return false;
  }
}

function encodeMembership(membership: Membership): Bytes {
  return utf8(
    JSON.stringify([
      "teneo vault membership 1",
      membership.vaultId,
      membership.primaryId,
      membership.generation,
      membership.keyHash,
      membership.members.map(({ deviceId, publicKey }) => [
        deviceId,
        publicKey,
      ]),
    ]),
  );
}

function parseMembership(value: unknown): Membership | null {
  const m = object(value);
  if (
    !m ||
    !isDeviceId(m.vaultId) ||
    !isDeviceId(m.primaryId) ||
    typeof m.generation !== "number" ||
    !Number.isSafeInteger(m.generation) ||
    m.generation < 1 ||
    typeof m.keyHash !== "string" ||
    !hex256.test(m.keyHash) ||
    !Array.isArray(m.members) ||
    !m.members.length ||
    m.members.length > maxVaultMembers
  )
    return null;

  const members: DevicePublicIdentity[] = [];
  const publicKeys = new Set<string>();
  let prev = "";
  for (const value of m.members) {
    const device = parseDeviceIdentity(value);
    if (!device || device.deviceId <= prev || publicKeys.has(device.publicKey))
      return null;
    members.push(device);
    prev = device.deviceId;
    publicKeys.add(device.publicKey);
  }
  if (!members.some((device) => device.deviceId === m.primaryId)) return null;
  return Object.freeze({
    vaultId: m.vaultId,
    primaryId: m.primaryId,
    generation: m.generation,
    keyHash: m.keyHash,
    members: Object.freeze(members),
  });
}

/** One immutable, verified snapshot. The vault key is never part of proofs. */
export class VaultTrust {
  readonly pin: VaultPin;
  readonly generation: number;
  /** Fingerprint of the signed body, independent of ECDSA encoding variance. */
  readonly fingerprint: string;
  readonly #update: VaultTrustUpdate;

  private constructor(
    pin: VaultPin,
    update: VaultTrustUpdate,
    fingerprint: string,
  ) {
    this.pin = pin;
    this.generation = update.membership.generation;
    this.fingerprint = fingerprint;
    this.#update = update;
    Object.freeze(this);
  }

  /** Verify a snapshot against a pin learned out of band, never from the update. */
  static async load(
    pin: VaultPin,
    device: DevicePublicIdentity,
    untrusted: unknown,
  ): Promise<VaultTrust> {
    const primary = parseDeviceIdentity(pin.primary);
    const update = object(untrusted);
    const membership = parseMembership(update?.membership);
    const signature = update?.signature;
    const vaultKey = update?.vaultKey;
    if (
      !primary ||
      !membership ||
      membership.vaultId !== pin.vaultId ||
      membership.primaryId !== primary.deviceId ||
      !acceptsIdentity(
        membership.members.find(
          (member) => member.deviceId === primary.deviceId,
        ),
        primary,
      ) ||
      !acceptsIdentity(
        membership.members.find(
          (member) => member.deviceId === device.deviceId,
        ),
        device,
      ) ||
      typeof signature !== "string" ||
      typeof vaultKey !== "string"
    )
      throw new Error("This device is not authorized for the vault update");

    const key = canonicalBytes(vaultKey, 32);
    const payload = encodeMembership(membership);
    try {
      if (
        !key ||
        toHex(await sha256(key)) !== membership.keyHash ||
        !(await verifyDeviceSignature(primary, payload, signature))
      )
        throw new Error("The vault update could not be verified");
    } finally {
      key?.fill(0);
    }
    return new VaultTrust(
      Object.freeze({ vaultId: membership.vaultId, primary }),
      Object.freeze({ membership, signature, vaultKey }),
      toHex(await sha256(payload)),
    );
  }

  /** Start a new trust domain. A legacy key is deliberately not an input. */
  static async create(primary: DeviceIdentity): Promise<VaultTrust> {
    return VaultTrust.issue(
      { vaultId: toHex(randomBytes(16)), primary },
      primary,
      1,
      [primary],
      toBase64(randomBytes(32)),
    );
  }

  member(deviceId: string): DevicePublicIdentity | undefined {
    return this.#update.membership.members.find((m) => m.deviceId === deviceId);
  }

  members(): readonly DevicePublicIdentity[] {
    return this.#update.membership.members;
  }

  /** For atomic secure storage, or to deliver to an authenticated member. */
  snapshot(): VaultTrustUpdate {
    return this.#update;
  }

  /** Only call after explicit out-of-band approval of this key. */
  async enroll(
    primary: DeviceIdentity,
    device: DevicePublicIdentity,
  ): Promise<VaultTrust> {
    if (this.member(device.deviceId))
      throw new Error("This device is already enrolled");
    return VaultTrust.issue(
      this.pin,
      primary,
      this.generation + 1,
      [...this.#update.membership.members, device],
      this.#update.vaultKey,
    );
  }

  async rotate(
    primary: DeviceIdentity,
    revokeDeviceId?: string,
  ): Promise<VaultTrust> {
    if (
      revokeDeviceId !== undefined &&
      (revokeDeviceId === this.pin.primary.deviceId ||
        !this.member(revokeDeviceId))
    )
      throw new Error("That device cannot be revoked from this vault");
    return VaultTrust.issue(
      this.pin,
      primary,
      this.generation + 1,
      this.#update.membership.members.filter(
        (m) => m.deviceId !== revokeDeviceId,
      ),
      toBase64(randomBytes(32)),
    );
  }

  async accept(
    device: DevicePublicIdentity,
    untrusted: unknown,
  ): Promise<VaultTrust> {
    const next = await VaultTrust.load(this.pin, device, untrusted);
    if (next.generation > this.generation) return next;
    if (next.fingerprint === this.fingerprint) return this;
    throw new Error("The vault update is stale or conflicts with this device");
  }

  private static async issue(
    pin: VaultPin,
    primary: DeviceIdentity,
    generation: number,
    devices: readonly DevicePublicIdentity[],
    vaultKey: string,
  ): Promise<VaultTrust> {
    if (!acceptsIdentity(pin.primary, primary))
      throw new Error("Only the primary device can change the vault");
    const key = fromBase64(vaultKey)!;
    let keyHash: string;
    try {
      keyHash = toHex(await sha256(key));
    } finally {
      key.fill(0);
    }
    const membership = parseMembership({
      vaultId: pin.vaultId,
      generation,
      primaryId: pin.primary.deviceId,
      keyHash,
      members: [...devices].sort((a, b) =>
        a.deviceId < b.deviceId ? -1 : a.deviceId === b.deviceId ? 0 : 1,
      ),
    });
    if (!membership) throw new Error("Invalid vault membership");
    const signature = toBase64(
      await primary.sign(encodeMembership(membership)),
    );
    return VaultTrust.load(pin, primary, { membership, signature, vaultKey });
  }
}

/** Serializes changes so a primary never signs two different committed
 * generations at once. A store must replace the entire secret snapshot or
 * leave the previous one intact; resolve only after durable storage. */
export class VaultTrustManager {
  readonly identity: DeviceIdentity;
  #trust: VaultTrust;
  #pending = false;
  #queue = Promise.resolve();
  readonly #persist: (trust: VaultTrust) => Promise<void>;
  readonly #pause = new Set<() => void>();

  constructor(
    identity: DeviceIdentity,
    trust: VaultTrust,
    persist: (trust: VaultTrust) => Promise<void>,
  ) {
    if (!acceptsIdentity(trust.member(identity.deviceId), identity))
      throw new Error("This device is not in the trusted list");
    this.identity = identity;
    this.#trust = trust;
    this.#persist = persist;
  }

  get current(): VaultTrust {
    return this.#trust;
  }

  permits(trust: VaultTrust): boolean {
    return !this.#pending && trust === this.#trust;
  }

  beforeInstall(pause: () => void): () => void {
    this.#pause.add(pause);
    return () => this.#pause.delete(pause);
  }

  enroll(
    device: DevicePublicIdentity,
    expected: VaultTrust,
  ): Promise<VaultTrust> {
    return this.change(async (trust) => {
      if (trust !== expected)
        throw new Error(
          "Create a new invitation after the device list changes",
        );
      // The prior enrollment may have committed on the primary just before the
      // connection failed. A fresh approval can resend it to the exact key.
      if (acceptsIdentity(trust.member(device.deviceId), device)) return trust;
      return trust.enroll(this.identity, device);
    });
  }

  rotate(revokeDeviceId?: string): Promise<VaultTrust> {
    return this.change((trust) => trust.rotate(this.identity, revokeDeviceId));
  }

  accept(
    update: unknown,
    matches: (trust: VaultTrust) => boolean,
  ): Promise<VaultTrust> {
    return this.change(async (trust) => {
      const verified = await trust.accept(this.identity, update);
      if (!matches(verified))
        throw new Error("The update differs from the advertised device list");
      return verified;
    });
  }

  private change(
    next: (current: VaultTrust) => Promise<VaultTrust>,
  ): Promise<VaultTrust> {
    const result = this.#queue.then(async () => {
      const candidate = await next(this.#trust);
      if (candidate === this.#trust) return candidate;
      this.#pending = true;
      try {
        for (const pause of this.#pause) pause();
        await this.#persist(candidate);
        this.#trust = candidate;
        return candidate;
      } finally {
        this.#pending = false;
      }
    });
    this.#queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
