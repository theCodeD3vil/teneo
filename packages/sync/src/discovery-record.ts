// What a device of a vault announces on the local network (Bonjour on the
// Mac, NSD on Android: NsdDiscovery.java keeps the same rules, and the test
// vectors in discovery-record.test.ts hold both to them).
//
// Version 1 announced the vault's tag and the device's id as they are, so
// anyone on a café's Wi-Fi could follow a device from network to network
// and tell which devices belong together. Now each announcement starts from
// a random salt, picked anew whenever discovery starts (launch, network
// change, wake), and says only:
//   instance  teneo-<salt>
//   s         the salt, 16 hex digits
//   vt        HMAC(key, "vt|" + salt), 16 hex digits: "of this vault", to
//             whoever holds the key
//   dev       the device id XOR HMAC(key, "dev|" + salt): the id, to them
// key is the vault's discovery key (deriveVaultKeys), hex. To anyone else
// every field is random, and differs on every network.
import {
  fromHex,
  hmacSha256,
  randomBytes,
  timingSafeEqual,
  toHex,
  utf8,
} from "./crypto";
import { isDeviceId } from "./hlc";

export interface DiscoveryRecord {
  instance: string;
  txt: { s: string; vt: string; dev: string };
}

async function mac(key: string, label: string): Promise<Uint8Array> {
  const keyBytes = fromHex(key);
  if (!keyBytes) throw new Error("A discovery key is hex");
  return hmacSha256(keyBytes, utf8(label));
}

const xor = (a: Uint8Array, b: Uint8Array) => a.map((byte, i) => byte ^ b[i]!);

export async function makeDiscoveryRecord(
  key: string,
  deviceId: string,
  salt: string = toHex(randomBytes(8)),
): Promise<DiscoveryRecord> {
  const [tag, pad] = await Promise.all([
    mac(key, `vt|${salt}`),
    mac(key, `dev|${salt}`),
  ]);
  return {
    instance: `teneo-${salt}`,
    txt: {
      s: salt,
      vt: toHex(tag.subarray(0, 8)),
      dev: toHex(xor(fromHex(deviceId)!, pad.subarray(0, 16))),
    },
  };
}

/** The id of the device that announced `txt`, or null when it is no device
 *  of this vault: another vault's, version 1's, or garbled. */
export async function readDiscoveryRecord(
  key: string,
  txt: Partial<Record<string, string>>,
): Promise<string | null> {
  const { s: salt, vt, dev } = txt;
  if (!salt || !/^[0-9a-f]{16}$/.test(salt)) return null;
  const tag = vt ? fromHex(vt) : null;
  const masked = dev ? fromHex(dev) : null;
  if (!tag || tag.length !== 8 || !masked || masked.length !== 16) return null;
  const [expected, pad] = await Promise.all([
    mac(key, `vt|${salt}`),
    mac(key, `dev|${salt}`),
  ]);
  if (!timingSafeEqual(tag, expected.subarray(0, 8))) return null;
  const deviceId = toHex(xor(masked, pad.subarray(0, 16)));
  return isDeviceId(deviceId) ? deviceId : null;
}
