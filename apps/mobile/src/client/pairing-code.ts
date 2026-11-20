import { type Bytes, parsePairingLink, parseRecoveryCode } from "@teneo/sync";

export interface PairingCode {
  /** The vault key, or a QR code's one-time key when `pairing` */
  vaultKey: Bytes;
  /** The Mac's addresses, from a QR code's link; none for a recovery code */
  addresses: string[];
  /** A QR code's one-time key: the vault's comes from the Mac (engine.ts) */
  pairing: boolean;
}

export const invalidCodeMessage =
  "That code doesn't look right. Scan the QR code on your Mac again, or check the join code and try again.";

/** What was scanned or typed, read with the sync core's own parsers: the QR
 *  code's `teneo://pair?...` link, or a recovery code. Null when it is
 *  neither, or is mistyped. */
export async function readPairingCode(
  code: string,
): Promise<PairingCode | null> {
  const trimmed = code.trim();
  if (!trimmed) return null;
  if (/^teneo:/i.test(trimmed)) {
    const link = parsePairingLink(trimmed);
    if (!link) return null;
    return link.kind === "pairing"
      ? { vaultKey: link.pairingKey, addresses: link.addresses, pairing: true }
      : { vaultKey: link.vaultKey, addresses: link.addresses, pairing: false };
  }
  const vaultKey = await parseRecoveryCode(trimmed);
  return vaultKey ? { vaultKey, addresses: [], pairing: false } : null;
}
