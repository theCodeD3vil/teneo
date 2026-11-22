import type { Channel } from "./channel";
import { fromBase64, randomBytes, toBase64 } from "./crypto";
import { isDeviceId } from "./hlc";
import { handshakeMs } from "./protocol";
import { type EnrollmentInvite, Session, SyncError } from "./session";
import {
  type DeviceIdentity,
  parseDeviceIdentity,
  type VaultPin,
  VaultTrust,
} from "./vault-trust";

const prefix = "teneo://pair?";
const addressPattern = /^[A-Za-z0-9.\-[\]:]+:\d{1,5}$/;
const lifetime = 10 * 60 * 1000;
export const enrollmentApprovalMs = 90_000;

export class EnrollmentInvites {
  #invite: (EnrollmentInvite & { expiresAt: number }) | null = null;

  create(pin: VaultPin, addresses: string[], now = Date.now()): string {
    if (
      addresses.length > 16 ||
      addresses.some((address) => !addressPattern.test(address))
    )
      throw new Error("Invalid primary device addresses");
    const key = randomBytes(32);
    const params = new URLSearchParams({
      v: "3",
      vault: pin.vaultId,
      primary: pin.primary.deviceId,
      pub: pin.primary.publicKey,
      key: toBase64(key),
      a: addresses.join(","),
    });
    this.#invite = { pin, key, expiresAt: now + lifetime };
    return `${prefix}${params}`;
  }

  current(now = Date.now()): EnrollmentInvite | null {
    return this.#invite && now < this.#invite.expiresAt ? this.#invite : null;
  }

  /** Synchronous check-and-consume, even if handshakes race one another. */
  claim(invite: EnrollmentInvite, now = Date.now()): boolean {
    if (invite !== this.current(now)) return false;
    this.#invite = null;
    return true;
  }

  cancel(): void {
    this.#invite = null;
  }
}

export function parseEnrollmentLink(
  link: string,
): (EnrollmentInvite & { addresses: string[] }) | null {
  if (!link.startsWith(prefix) || link.length > 2048) return null;
  const params = new URLSearchParams(link.slice(prefix.length));
  if (params.get("v") !== "3") return null;
  const vaultId = params.get("vault");
  const primary = parseDeviceIdentity({
    deviceId: params.get("primary"),
    publicKey: params.get("pub"),
  });
  const encoded = params.get("key");
  const key = encoded ? fromBase64(encoded) : null;
  const addresses = (params.get("a") ?? "").split(",").filter(Boolean);
  if (
    !primary ||
    !isDeviceId(vaultId) ||
    key?.length !== 32 ||
    toBase64(key) !== encoded ||
    addresses.length > 16 ||
    addresses.some((address) => !addressPattern.test(address))
  )
    return null;
  return { pin: { vaultId, primary }, key, addresses };
}

/** A joining device persists the full verified snapshot and primary pin
 *  before use. No legacy session or clipboard data is allowed on this channel. */
export async function joinTrustedVault(
  channel: Channel,
  identity: DeviceIdentity,
  invite: EnrollmentInvite,
  persist: (trust: VaultTrust) => Promise<void>,
): Promise<VaultTrust> {
  const session = await Session.open(channel, {
    identity,
    deviceId: identity.deviceId,
    invite,
  });
  const timer = setTimeout(
    () => session.close(),
    enrollmentApprovalMs + handshakeMs,
  );
  try {
    return await new Promise<VaultTrust>((resolve, reject) => {
      let persisting = false;
      void session.closed.then((error) => {
        if (!persisting)
          reject(error ?? new SyncError("closed", "Enrollment did not finish"));
      });
      session.onFrame(async (frame) => {
        if (frame.t !== "trust-update" || persisting)
          throw new SyncError("protocol", "Unexpected enrollment frame");
        persisting = true;
        try {
          const trust = await VaultTrust.load(
            invite.pin,
            identity,
            frame.update,
          );
          await persist(trust);
          // If the primary missed this ack, the next normal connection proves
          // the joiner has the current snapshot. The join itself is durable.
          await session
            .send({ t: "trust-ack", fingerprint: trust.fingerprint })
            .catch(() => undefined);
          resolve(trust);
        } catch (error) {
          reject(error);
        }
      });
    });
  } finally {
    clearTimeout(timer);
    session.close();
  }
}
