import { describe, expect, test } from "bun:test";

import { buildPairingLink, formatRecoveryCode } from "@teneo/sync";

import { readPairingCode } from "./pairing-code";

const key = Uint8Array.from({ length: 32 }, (_, i) => i * 7);

describe("readPairingCode", () => {
  test("reads the Mac's QR link: a one-time key, with its addresses", async () => {
    const link = buildPairingLink(key, ["192.168.1.20:47823"]);
    expect(await readPairingCode(`  ${link}\n`)).toEqual({
      vaultKey: key,
      addresses: ["192.168.1.20:47823"],
      pairing: true,
    });
  });

  test("a recovery code is the vault key itself", async () => {
    expect(
      (await readPairingCode(await formatRecoveryCode(key)))?.pairing,
    ).toBe(false);
  });

  test("reads a recovery code however it was typed", async () => {
    const code = await formatRecoveryCode(key);
    for (const typed of [
      code,
      code.toLowerCase(),
      code.replaceAll("-", " "),
      ` ${code.replaceAll("-", "")} `,
    ]) {
      expect((await readPairingCode(typed))?.vaultKey).toEqual(key);
    }
  });

  test("refuses a mistyped recovery code", async () => {
    const code = await formatRecoveryCode(key);
    const last = code.at(-1) === "0" ? "1" : "0";
    expect(await readPairingCode(code.slice(0, -1) + last)).toBeNull();
    expect(await readPairingCode(code.slice(0, -5))).toBeNull();
  });

  test("refuses what isn't a Teneo code", async () => {
    for (const code of [
      "",
      "   ",
      "hello",
      "https://teneo.app/pair?v=1",
      "teneo://pair?v=2&k=" + "0".repeat(52),
      "teneo://pair?v=1&k=SHORT",
      buildPairingLink(key, []).replace("teneo://", "TENEO://"),
    ]) {
      expect(await readPairingCode(code)).toBeNull();
    }
  });
});
